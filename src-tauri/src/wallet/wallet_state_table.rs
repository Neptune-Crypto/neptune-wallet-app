use std::sync::atomic::Ordering;

use anyhow::Result;
use neptune_primitives::timestamp::Timestamp;
use neptune_wallet::address::KeyType;
use neptune_wallet::expected_utxo::ExpectedUtxo;
use neptune_wallet::twenty_first::tip5::Digest;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Pool;
use sqlx::Row;
use sqlx::Sqlite;
use sqlx::SqliteConnection;
use sqlx_migrator::Info;
use sqlx_migrator::Migrate;
use sqlx_migrator::Migrator;
use sqlx_migrator::Plan;
use tracing::info;
use tracing::trace;

use super::UtxoRecoveryData;
use super::WalletState;

struct CreateWalletStateNumKeysMigration;

sqlx_migrator::sqlite_migration!(
    CreateWalletStateNumKeysMigration,
    "wallet_state",
    "create_wallet_state_keys",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE wallet_state_keys (id TEXT PRIMARY KEY, value TEXT NOT NULL)", //up
        "DROP TABLE wallet_state_keys"                                               //down
    )]
);

struct CreateWalletStateUtxosMigration;
sqlx_migrator::sqlite_migration!(
    CreateWalletStateUtxosMigration,
    "wallet_state",
    "create_wallet_state_utxos",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE wallet_state_utxos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        recovery_data BLOB NOT NULL,
        spent_in_block TEXT DEFAULT NULL,
        confirmed_in_block TEXT NOT NULL,
        confirmed_txid TEXT DEFAULT NULL,
        spent_txid TEXT DEFAULT NULL,
        confirm_height INTEGER NOT NULL,
        spent_height INTEGER DEFAULT NULL
        )", //up
        "DROP TABLE wallet_state_utxos" //down
    )]
);

struct CreateWalletStateExpectedUtxoMigration;
sqlx_migrator::sqlite_migration!(
    CreateWalletStateExpectedUtxoMigration,
    "wallet_state",
    "create_wallet_state_expected_utxos",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE wallet_state_expected_utxos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        txid TEXT NOT NULL,
        data BLOB NOT NULL,
        timestamp INTEGER NOT NULL
        )",
        "DROP TABLE wallet_state_expected_utxos"
    )]
);

struct CreateWatchOnlyAddressesMigration;
sqlx_migrator::sqlite_migration!(
    CreateWatchOnlyAddressesMigration,
    "wallet_state",
    "create_watch_only_addresses",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // Externally-imported viewing keys, monitored for incoming UTXOs but
        // never spendable. `viewing_key` is the canonical bech32m string.
        "CREATE TABLE watch_only_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_type TEXT NOT NULL,
        viewing_key TEXT NOT NULL UNIQUE,
        label TEXT DEFAULT NULL,
        created_at INTEGER NOT NULL
        )", //up
        "DROP TABLE watch_only_addresses" //down
    )]
);

struct CreateWatchOnlyUtxosMigration;
sqlx_migrator::sqlite_migration!(
    CreateWatchOnlyUtxosMigration,
    "wallet_state",
    "create_watch_only_utxos",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // Confirmed incoming UTXOs for a watch-only address. Kept separate from
        // `wallet_state_utxos` so watch-only funds never count toward the
        // account balance nor become spendable. `amount` is nau as a string.
        // (watch_only_id, aocl_index) is unique so re-scanning a block can't
        // double-count, and `confirm_height` drives reorg rollback.
        //
        // `confirm_timestamp` is the confirming block header's timestamp, in
        // milliseconds — i.e. when this UTXO was received.
        "CREATE TABLE watch_only_utxos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_only_id INTEGER NOT NULL,
        aocl_index INTEGER NOT NULL,
        amount TEXT NOT NULL,
        confirm_height INTEGER NOT NULL,
        confirm_timestamp INTEGER NOT NULL,
        block_digest TEXT NOT NULL,
        UNIQUE(watch_only_id, aocl_index)
        )", //up
        "DROP TABLE watch_only_utxos" //down
    )]
);

struct AddWatchOnlyPreimageMigration;
sqlx_migrator::sqlite_migration!(
    AddWatchOnlyPreimageMigration,
    "wallet_state",
    "add_watch_only_preimage",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // Optional receiver preimage (hex Digest). Present => the entry can also
        // detect spends and show a real balance; absent => total-received only.
        "ALTER TABLE watch_only_addresses ADD COLUMN receiver_preimage TEXT DEFAULT NULL", //up
        "ALTER TABLE watch_only_addresses DROP COLUMN receiver_preimage"                   //down
    )]
);

struct AddWatchOnlySpendTrackingMigration;
sqlx_migrator::sqlite_migration!(
    AddWatchOnlySpendTrackingMigration,
    "wallet_state",
    "add_watch_only_spend_tracking",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![
        // `utxo` + `sender_randomness` let us recompute a receipt's absolute
        // index set (with the address's preimage) to detect spends; non-null
        // `spent_height` marks a receipt spent (and drives reorg rollback).
        (
            "ALTER TABLE watch_only_utxos ADD COLUMN utxo BLOB DEFAULT NULL",
            "ALTER TABLE watch_only_utxos DROP COLUMN utxo"
        ),
        (
            "ALTER TABLE watch_only_utxos ADD COLUMN sender_randomness TEXT DEFAULT NULL",
            "ALTER TABLE watch_only_utxos DROP COLUMN sender_randomness"
        ),
        (
            "ALTER TABLE watch_only_utxos ADD COLUMN spent_height INTEGER DEFAULT NULL",
            "ALTER TABLE watch_only_utxos DROP COLUMN spent_height"
        )
    ]
);

struct CreatePayoutPoliciesMigration;
sqlx_migrator::sqlite_migration!(
    CreatePayoutPoliciesMigration,
    "wallet_state",
    "create_payout_policies",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // A daily payout policy attached to a watch-only address (the "meter").
        // At most one per address. Payouts are sent from this account's own
        // balance; the watched address only decides how much.
        //
        // Amounts/rates are decimal strings applied to i128 nau backend-side.
        // `run_time` is minutes-of-day in the user's local wall clock.
        // `meter_start` (ms) is stamped when the policy is armed and reset on
        // each re-arm; only receipts confirmed after it are ever paid against.
        "CREATE TABLE payout_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_only_id INTEGER NOT NULL UNIQUE,
        recipient TEXT NOT NULL,
        basis TEXT NOT NULL,
        multiplier TEXT NOT NULL,
        min_lock_days INTEGER DEFAULT NULL,
        max_lock_days INTEGER NOT NULL,
        max_daily_payout TEXT DEFAULT NULL,
        min_confirmations INTEGER NOT NULL,
        run_time INTEGER NOT NULL,
        armed INTEGER NOT NULL DEFAULT 0,
        meter_start INTEGER DEFAULT NULL,
        last_run_at INTEGER DEFAULT NULL,
        created_at INTEGER NOT NULL
        )", //up
        "DROP TABLE payout_policies" //down
    )]
);

struct CreatePayoutAccountedReceiptsMigration;
sqlx_migrator::sqlite_migration!(
    CreatePayoutAccountedReceiptsMigration,
    "wallet_state",
    "create_payout_accounted_receipts",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // A receipt that a payout run has already counted (whether it paid or
        // dropped on insufficient funds), so it is never paid against twice.
        //
        // Deliberately NOT a column on `watch_only_utxos`: those rows are deleted
        // and rebuilt on reorg rollback / rescan, which would wipe the accounting
        // and re-pay everything. This table is keyed by `(watch_only_id,
        // aocl_index)` — a deterministic, rescan-stable identity (re-scanning the
        // same chain re-inserts each UTXO with the same AOCL index) — and is
        // never touched by rollback, so the accounting survives a full resync.
        "CREATE TABLE payout_accounted_receipts (
        watch_only_id INTEGER NOT NULL,
        aocl_index INTEGER NOT NULL,
        run_id INTEGER NOT NULL,
        accounted_at INTEGER NOT NULL,
        PRIMARY KEY (watch_only_id, aocl_index)
        )", //up
        "DROP TABLE payout_accounted_receipts" //down
    )]
);

struct CreatePayoutRunsMigration;
sqlx_migrator::sqlite_migration!(
    CreatePayoutRunsMigration,
    "wallet_state",
    "create_payout_runs",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        // Audit trail: one row per attempted daily run. `status` is one of
        // 'paid', 'skipped_insufficient_funds', 'skipped_no_receipts', 'failed'.
        // Amounts are nau strings. `output_commitments` records the broadcast
        // transaction by its output addition records (canonical commitments,
        // comma-separated hex).
        "CREATE TABLE payout_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        policy_id INTEGER NOT NULL,
        run_at INTEGER NOT NULL,
        basis_amount TEXT NOT NULL,
        payout_amount TEXT NOT NULL,
        fee TEXT NOT NULL,
        output_commitments TEXT DEFAULT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
        )", //up
        "DROP TABLE payout_runs" //down
    )]
);

#[derive(Debug, Clone, Serialize)]
pub(crate) struct UtxoDbData {
    pub(crate) id: i64,
    pub(crate) hash: String,
    pub(crate) recovery_data: UtxoRecoveryData,
    // hash of the block, if any, in which this UTXO was spent
    pub(crate) spent_in_block: Option<UtxoBlockInfo>,

    // hash of the block, if any, in which this UTXO was confirmed
    pub(crate) confirmed_in_block: UtxoBlockInfo,

    // this two values are used to rollback
    pub(crate) confirm_height: i64,
    pub(crate) spent_height: Option<i64>,

    pub(crate) confirmed_txid: Option<String>,
    pub(crate) spent_txid: Option<String>,
}

impl UtxoDbData {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct UtxoBlockInfo {
    pub(crate) block_height: u64,
    pub(crate) block_digest: Digest,
    pub(crate) timestamp: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tip {
    pub(crate) height: u64,
    pub(crate) digest: Digest,
}

impl UtxoDbData {
    fn from_row(row: sqlx::sqlite::SqliteRow) -> anyhow::Result<Self> {
        let recovery_data = row.get::<Vec<u8>, _>("recovery_data");
        let recovery_data = bincode::deserialize(&recovery_data)?;

        let spent_in_block = row.get::<Option<String>, _>("spent_in_block");
        let comfirmed_in_block = row.get::<String, _>("confirmed_in_block");

        let spent_in_block = match spent_in_block {
            Some(spent_in_block) => Some(serde_json::from_str::<UtxoBlockInfo>(&spent_in_block)?),
            None => None,
        };
        let confirmed_in_block = serde_json::from_str::<UtxoBlockInfo>(&comfirmed_in_block)?;

        Ok(Self {
            id: row.get("id"),
            hash: row.get("hash"),
            recovery_data,
            spent_in_block,
            confirmed_in_block,
            confirm_height: row.get("confirm_height"),
            spent_height: row.get("spent_height"),
            confirmed_txid: row.get("confirmed_txid"),
            spent_txid: row.get("spent_txid"),
        })
    }

    pub(crate) async fn create<'c, E>(&self, executor: E) -> anyhow::Result<()>
    where
        E: sqlx::Executor<'c, Database = Sqlite>,
    {
        let query = "INSERT INTO wallet_state_utxos (hash, recovery_data, confirmed_in_block, confirm_height) VALUES (?, ?, ?, ?)";

        let data = bincode::serialize(&self.recovery_data)?;

        let confirmed_in_block = serde_json::to_string(&self.confirmed_in_block)?;

        sqlx::query(query)
            .bind(&self.hash)
            .bind(&data)
            .bind(&confirmed_in_block)
            .bind(self.confirm_height)
            .execute(executor)
            .await?;
        Ok(())
    }
}

pub(crate) struct ExpectedUtxoData {
    #[expect(unused)]
    pub(crate) id: i64,
    pub(crate) txid: String,
    pub(crate) expected_utxo: ExpectedUtxo,
    /// created time, used to clean outdated data
    pub(crate) timestamp: Timestamp,
}

impl ExpectedUtxoData {
    fn from_row(row: sqlx::sqlite::SqliteRow) -> anyhow::Result<Self> {
        let expected_utxo = row.get::<Vec<u8>, _>("data");
        let expected_utxo = bincode::deserialize(&expected_utxo)?;

        Ok(Self {
            id: row.get("id"),
            txid: row.get("txid"),
            expected_utxo,
            timestamp: Timestamp::seconds(row.get::<i64, _>("timestamp").try_into()?),
        })
    }

    pub(crate) async fn create<'c, E>(&self, executor: E) -> anyhow::Result<()>
    where
        E: sqlx::Executor<'c, Database = Sqlite>,
    {
        let query =
            "INSERT INTO wallet_state_expected_utxos (txid, data, timestamp) VALUES (?, ?, ?)";

        let data = bincode::serialize(&self.expected_utxo)?;

        let timestamp: i64 = (self.timestamp.to_millis() / 1000) as i64;

        sqlx::query(query)
            .bind(&self.txid)
            .bind(&data)
            .bind(timestamp)
            .execute(executor)
            .await?;
        Ok(())
    }
}

impl WalletState {
    fn db_id(key_type: KeyType) -> &'static str {
        match key_type {
            KeyType::Generation => "num_generation_spending_keys",
            KeyType::Symmetric => "num_symmetric_keys",
            KeyType::EcHybrid => "num_ec_hybrid_keys",
            KeyType::ViewingAddress => "num_viewing_address_keys",
            _ => todo!(),
        }
    }

    pub(crate) async fn migrate_tables(&self) -> anyhow::Result<()> {
        let mut migrator = Migrator::default();
        // Adding migration can fail if another migration with same app and name and different values gets added
        // Adding migrations add its parents, replaces and not before as well
        migrator.add_migration(Box::new(CreateWalletStateNumKeysMigration))?;
        migrator.add_migration(Box::new(CreateWalletStateUtxosMigration))?;
        migrator.add_migration(Box::new(CreateWalletStateExpectedUtxoMigration))?;
        migrator.add_migration(Box::new(CreateWatchOnlyAddressesMigration))?;
        migrator.add_migration(Box::new(CreateWatchOnlyUtxosMigration))?;
        migrator.add_migration(Box::new(AddWatchOnlyPreimageMigration))?;
        migrator.add_migration(Box::new(AddWatchOnlySpendTrackingMigration))?;
        migrator.add_migration(Box::new(CreatePayoutPoliciesMigration))?;
        migrator.add_migration(Box::new(CreatePayoutAccountedReceiptsMigration))?;
        migrator.add_migration(Box::new(CreatePayoutRunsMigration))?;

        let mut conn = self.pool.acquire().await?;
        // use apply all to apply all pending migration
        migrator.run(&mut *conn, &Plan::apply_all()).await?;

        Ok(())
    }

    /// Update both the ephemeral and the persisted key index
    pub(crate) async fn set_key_index(&self, key_type: KeyType, value: u64) -> Result<()> {
        let db_id = Self::db_id(key_type);
        trace!("setting {db_id} key index to: {value}");
        let value_db = value.to_string();
        let query = format!("INSERT INTO wallet_state_keys (id, value) VALUES ('{db_id}', ?) ON CONFLICT(id) DO UPDATE SET value = ?");
        sqlx::query(&query)
            .bind(&value_db)
            .bind(&value_db)
            .execute(&self.pool)
            .await?;

        self.set_ephemeral_key_index(key_type, value, Ordering::Relaxed);

        Ok(())
    }

    /// Return the key index of the *next* address to be derived.
    ///
    /// Equivalent to the number of addresses of this type derived by the
    /// wallet.
    pub(crate) async fn persisted_key_index_from_pool(
        key_type: KeyType,
        pool: &Pool<Sqlite>,
    ) -> Result<u64> {
        let db_id = Self::db_id(key_type);
        let row = sqlx::query(&format!(
            "SELECT value FROM wallet_state_keys WHERE id = '{db_id}'"
        ))
        .fetch_one(pool)
        .await;

        match row {
            Ok(row) => Ok(std::cmp::max(1, row.get::<String, _>(0).parse()?)),
            Err(sqlx::Error::RowNotFound) => Ok(1),
            Err(err) => Err(err)?,
        }
    }

    pub(crate) async fn persisted_key_index(&self, key_type: KeyType) -> Result<u64> {
        Self::persisted_key_index_from_pool(key_type, &self.pool).await
    }

    pub(crate) async fn set_tip(
        &self,
        tx: &mut SqliteConnection,
        (height, digest): (u64, Digest),
    ) -> Result<()> {
        let tip = Tip { height, digest };

        trace!("Setting tip to: ({height}, {digest:x})");

        let value_db = serde_json::to_string(&tip)?;
        sqlx::query("INSERT INTO wallet_state_keys (id, value) VALUES ('tip', ?) ON CONFLICT(id) DO UPDATE SET value = ?")
            .bind(&value_db)
            .bind(&value_db)
            .execute(&mut *tx).await?;
        Ok(())
    }

    pub(crate) async fn get_tip(&self) -> Result<Option<(u64, Digest)>> {
        Self::persisted_tip_from_pool(&self.pool).await
    }

    /// Read a wallet's persisted sync tip without constructing a full
    /// [`WalletState`].
    ///
    /// Used by the accounts list, which opens each wallet database briefly to
    /// report how far that account has synced.
    pub(crate) async fn persisted_tip_from_pool(
        pool: &Pool<Sqlite>,
    ) -> Result<Option<(u64, Digest)>> {
        let row = sqlx::query("SELECT value FROM wallet_state_keys WHERE id = 'tip'")
            .fetch_one(pool)
            .await;

        match row {
            Ok(row) => {
                let tip: Tip = serde_json::from_str(&row.get::<String, _>(0))?;
                trace!("Got tip from database: ({}, {:x})", tip.height, tip.digest);
                Ok(Some((tip.height, tip.digest)))
            }
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(err) => Err(err)?,
        }
    }

    pub(crate) async fn append_utxos(
        &self,
        tx: &mut SqliteConnection,
        utxos: Vec<UtxoDbData>,
    ) -> Result<()> {
        for utxo in utxos {
            let tx = &mut *tx;
            utxo.create(&mut *tx).await?;
        }

        Ok(())
    }

    pub(crate) async fn update_spent_utxos(
        &self,
        tx: &mut SqliteConnection,
        utxos: Vec<(i64, UtxoBlockInfo)>,
    ) -> Result<()> {
        for utxo in &utxos {
            let info = serde_json::to_string(&utxo.1)?;

            sqlx::query::<Sqlite>("UPDATE wallet_state_utxos SET spent_in_block = ? WHERE id = ?")
                .bind(&info)
                .bind(utxo.0)
                .execute(&mut *tx)
                .await?;
        }

        // remove from pending so it will not be updated again
        for (id, _) in utxos {
            info!("checking utxo {} for pending", id);
            if let Some(txid) = self.updater.try_remove_pending_by_utxo_id(tx, id).await? {
                info!("removing pending tx {}", txid);
                sqlx::query::<Sqlite>("UPDATE wallet_state_utxos SET spent_txid = ? WHERE id = ?")
                    .bind(&txid)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            };
        }

        Ok(())
    }

    pub(crate) async fn update_utxos_with_expected_utxos(
        &self,
        tx: &mut SqliteConnection,
        utxos: Vec<(Digest, String)>,
        height: i64,
    ) -> Result<()> {
        for (digest, txid) in utxos {
            let hash = digest.to_hex();
            sqlx::query(
                "UPDATE wallet_state_utxos SET confirmed_txid = ? WHERE hash = ? AND confirm_height = ?",
            )
            .bind(&txid)
            .bind(&hash)
            .bind(height)
            .execute(&mut *tx)
            .await?;
        }

        Ok(())
    }

    pub(crate) async fn get_utxos(&self) -> Result<Vec<UtxoDbData>> {
        let mut conn = self.pool.acquire().await?;
        let rows = sqlx::query("SELECT * FROM wallet_state_utxos")
            .fetch_all(&mut *conn)
            .await?;

        let mut utxos: Vec<UtxoDbData> = Vec::new();
        for row in rows {
            let utxo = UtxoDbData::from_row(row)?;
            utxos.push(utxo);
        }

        Ok(utxos)
    }

    pub(crate) async fn get_utxo_db_data(&self, hash: &Digest) -> Result<Option<UtxoDbData>> {
        let hash = hash.to_hex();
        let row = sqlx::query("SELECT * FROM wallet_state_utxos WHERE hash =?")
            .bind(&hash)
            .fetch_one(&self.pool)
            .await;

        match row {
            Ok(row) => {
                let data: UtxoDbData = UtxoDbData::from_row(row)?;
                Ok(Some(data))
            }
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    pub(crate) async fn get_unspent_utxos(
        &self,
        tx: &mut SqliteConnection,
    ) -> Result<Vec<UtxoDbData>> {
        let rows = sqlx::query("SELECT * FROM wallet_state_utxos WHERE spent_in_block IS NULL")
            .fetch_all(&mut *tx)
            .await?;

        let mut utxos: Vec<UtxoDbData> = Vec::new();
        for row in rows {
            let utxo = UtxoDbData::from_row(row)?;
            utxos.push(utxo);
        }

        Ok(utxos)
    }

    pub(crate) async fn get_unspent_inputs_with_ids(&self, ids: &[i64]) -> Result<Vec<UtxoDbData>> {
        let mut conn = self.pool.acquire().await?;

        let mut utxos = Vec::with_capacity(ids.len());
        for id in ids {
            let row = sqlx::query(
                "SELECT * FROM wallet_state_utxos WHERE spent_in_block IS NULL AND id = ?",
            )
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
            let utxo = UtxoDbData::from_row(row)?;
            utxos.push(utxo);
        }

        Ok(utxos)
    }

    pub(crate) async fn add_expected_utxo(&self, utxo: Vec<ExpectedUtxoData>) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        for expedted in utxo {
            expedted.create(&mut *tx).await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub(crate) async fn expected_utxos(&self) -> Result<Vec<ExpectedUtxoData>> {
        let mut conn = self.pool.acquire().await?;
        let rows = sqlx::query("SELECT * FROM wallet_state_expected_utxos")
            .fetch_all(&mut *conn)
            .await?;

        let mut utxos: Vec<ExpectedUtxoData> = Vec::new();
        for row in rows {
            let utxo = ExpectedUtxoData::from_row(row)?;
            utxos.push(utxo);
        }

        Ok(utxos)
    }

    pub(crate) async fn update_new_generation_expected_utxos(
        &self,
        txid: &str,
        timestamp: Timestamp,
        expected_utxos: Vec<ExpectedUtxo>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        // sqlx::query("DELETE FROM wallet_state_expected_utxos WHERE txid = ?")
        //     .bind(txid)
        //     .execute(&mut *tx)
        //     .await?;

        for utxo in expected_utxos {
            let expected_data = ExpectedUtxoData {
                id: 0,
                txid: txid.to_owned(),
                expected_utxo: utxo,
                timestamp,
            };

            expected_data.create(&mut *tx).await?;
        }
        Ok(())
    }

    pub(crate) async fn clean_old_expected_utxos(&self) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        let now = Timestamp::now().to_millis() / 1000;
        let begin = now - (2 * 60 * 60);
        let begin: i64 = begin.try_into()?;
        sqlx::query("DELETE FROM wallet_state_expected_utxos WHERE timestamp < ?")
            .bind(begin)
            .execute(&mut *conn)
            .await?;
        Ok(())
    }

    // Roll back state to a block defined by a height and a block hash.
    pub(crate) async fn roll_back(
        &self,
        tx: &mut SqliteConnection,
        height: u64,
        digest: Digest,
    ) -> Result<()> {
        let height_i64 = height as i64;

        let ids = sqlx::query("SELECT id FROM wallet_state_utxos WHERE confirm_height > ?")
            .bind(height_i64)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| row.get::<i64, _>(0))
            .collect::<Vec<_>>();

        self.updater
            .try_clean_pending_by_utxo(&mut *tx, ids)
            .await?;

        sqlx::query("DELETE FROM wallet_state_utxos WHERE confirm_height > ?")
            .bind(height_i64)
            .execute(&mut *tx)
            .await?;

        sqlx::query("UPDATE wallet_state_utxos SET spent_height = NULL, spent_txid = NULL, spent_in_block = NULL WHERE spent_height > ?")
            .bind(height_i64)
            .execute(&mut *tx)
            .await?;

        // Drop watch-only receipts confirmed above the rollback height, and undo
        // spends recorded above it. The watch-only addresses themselves are
        // user-imported and kept intact.
        sqlx::query("DELETE FROM watch_only_utxos WHERE confirm_height > ?")
            .bind(height_i64)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE watch_only_utxos SET spent_height = NULL WHERE spent_height > ?")
            .bind(height_i64)
            .execute(&mut *tx)
            .await?;

        self.set_tip(&mut *tx, (height, digest)).await?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use neptune_primitives::network::Network;
    use neptune_wallet::wallet_entropy::WalletEntropy;

    use super::*;
    use crate::config::wallet::ScanConfig;
    use crate::config::wallet::WalletConfig;
    use crate::tests::test_wallet_db;

    #[tokio::test]
    async fn test_migrate_tables() {
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 1,
                start_height: 0,
                ..Default::default()
            },
            network: Network::Main,
        };

        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config, &db_path).await.unwrap();

        wallet_state.migrate_tables().await.unwrap();

        wallet_state
            .set_key_index(KeyType::Symmetric, 2)
            .await
            .unwrap();
        wallet_state
            .set_key_index(KeyType::Generation, 3)
            .await
            .unwrap();
        wallet_state
            .set_key_index(KeyType::EcHybrid, 4)
            .await
            .unwrap();
        wallet_state
            .set_key_index(KeyType::ViewingAddress, 5)
            .await
            .unwrap();

        assert_eq!(
            wallet_state
                .persisted_key_index(KeyType::Symmetric)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            wallet_state
                .persisted_key_index(KeyType::Generation)
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            wallet_state
                .persisted_key_index(KeyType::EcHybrid)
                .await
                .unwrap(),
            4
        );
        assert_eq!(
            wallet_state
                .persisted_key_index(KeyType::ViewingAddress)
                .await
                .unwrap(),
            5
        );
    }
}
