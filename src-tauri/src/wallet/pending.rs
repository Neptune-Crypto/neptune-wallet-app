use std::sync::Arc;

use anyhow::Result;
use neptune_wallet::transaction_details::TransactionDetails;
use sqlx::Row;
use sqlx::SqliteConnection;
use sqlx::SqlitePool;
use sqlx_migrator::Info;
use sqlx_migrator::Migrate;
use sqlx_migrator::Migrator;
use sqlx_migrator::Plan;
use tracing::*;

use crate::config::Config;

impl super::WalletState {
    // txid, amount
    pub(crate) async fn get_pending_transactions(&self) -> Result<Vec<String>> {
        self.updater.get_pending_transaction_ids().await
    }

    pub(crate) async fn forget_tx(&self, txid: &str) -> Result<()> {
        self.updater.delete_transaction(txid).await?;

        // Forgetting frees the pending inputs, so the account's balance grows
        // back; refresh the accounts list's cached total (otherwise only
        // rewritten on block sync). Best-effort, same as after a send: the
        // forget itself already succeeded.
        match self.get_all_balance().await {
            Ok((_available, _pending, total)) => {
                let config = crate::service::get_state::<Arc<Config>>();
                if let Err(e) = config
                    .update_wallet_balance(self.id, total.display_lossless())
                    .await
                {
                    warn!(
                        "Could not update cached account balance after forget: {}",
                        e
                    );
                }
            }
            Err(e) => warn!("Could not compute balance after forget: {}", e),
        }

        Ok(())
    }
}

struct CreatePendingTxMigration;

sqlx_migrator::sqlite_migration!(
    CreatePendingTxMigration,
    "wallet_state",
    "create_pengind_tx",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE wallet_state_pending (
        id TEXT PRIMARY KEY,
        details BLOB NOT NULL,
        finished INTEGER NOT NULL DEFAULT 0
        )", //up
        "DROP TABLE wallet_state_pending" //down
    )]
);

struct CreatePendingTxDbIdsMigration;

sqlx_migrator::sqlite_migration!(
    CreatePendingTxDbIdsMigration,
    "wallet_state",
    "create_pengind_tx_dbids",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE wallet_state_pending_ids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        txid TEXT NOT NULL,
        utxo_id INTEGER NOT NULL,
        finished INTEGER NOT NULL DEFAULT 0
        )", //up
        "DROP TABLE wallet_state_pending_ids" //down
    )]
);

pub(crate) struct TransactionUpdater {
    pool: SqlitePool,
}

// upgrade transaction after new block
impl TransactionUpdater {
    pub(crate) async fn new(pool: SqlitePool) -> anyhow::Result<Self> {
        let updater = Self { pool };

        updater.migrate_tables().await?;
        Ok(updater)
    }

    pub(crate) async fn migrate_tables(&self) -> anyhow::Result<()> {
        let mut migrator = Migrator::default();
        // Adding migration can fail if another migration with same app and name and different values gets added
        // Adding migrations add its parents, replaces and not before as well
        migrator.add_migration(Box::new(CreatePendingTxMigration))?;
        migrator.add_migration(Box::new(CreatePendingTxDbIdsMigration))?;

        let mut conn = self.pool.acquire().await?;
        // use apply all to apply all pending migration
        migrator.run(&mut *conn, &Plan::apply_all()).await?;

        Ok(())
    }

    pub(crate) async fn add_transaction(
        &self,
        tx_id: String,
        detail: TransactionDetails,
        input_ids: Vec<i64>,
    ) -> Result<()> {
        let mut conn = self.pool.begin().await?;

        let detail = bincode::serialize(&detail)?;

        sqlx::query("INSERT INTO wallet_state_pending (id, details) VALUES (?, ?)")
            .bind(&tx_id)
            .bind(&detail)
            .execute(&mut *conn)
            .await?;

        for utxo_id in input_ids {
            sqlx::query("INSERT INTO wallet_state_pending_ids (txid, utxo_id) VALUES (?, ?)")
                .bind(&tx_id)
                .bind(utxo_id)
                .execute(&mut *conn)
                .await?;
        }

        conn.commit().await?;

        Ok(())
    }

    pub(crate) async fn get_pending_transactions(
        &self,
        tx: &mut SqliteConnection,
    ) -> Result<Vec<(String, TransactionDetails, Vec<i64>)>> {
        let rows = sqlx::query("SELECT * FROM wallet_state_pending WHERE finished = 0")
            .fetch_all(&mut *tx)
            .await?;

        let mut result = vec![];
        for row in rows {
            let txid = row.get::<String, _>("id");
            let detail = row.get::<Vec<u8>, _>("details");
            let detail = bincode::deserialize::<TransactionDetails>(&detail)?;

            let spent_utxos =
                sqlx::query("SELECT utxo_id FROM wallet_state_pending_ids WHERE txid = ?")
                    .bind(&txid)
                    .fetch_all(&mut *tx)
                    .await?
                    .into_iter()
                    .map(|row| row.get::<i64, _>(0))
                    .collect::<Vec<_>>();

            result.push((txid, detail, spent_utxos));
        }

        Ok(result)
    }

    pub(crate) async fn delete_transaction(&self, tx_id: &str) -> Result<()> {
        let mut conn = self.pool.acquire().await?;

        sqlx::query("DELETE FROM wallet_state_pending WHERE id = ?")
            .bind(tx_id)
            .execute(&mut *conn)
            .await?;

        sqlx::query("DELETE FROM wallet_state_pending_ids WHERE txid = ?")
            .bind(tx_id)
            .execute(&mut *conn)
            .await?;

        Ok(())
    }

    /// Pending transaction ids, newest send first.
    /// No send timestamp exists, so insertion order stands in: `rowid` only ever
    /// reuses the largest freed value, so descending is newest-first.
    pub(crate) async fn get_pending_transaction_ids(&self) -> Result<Vec<String>> {
        let mut conn = self.pool.acquire().await?;

        let transactions = sqlx::query(
            "SELECT id FROM wallet_state_pending WHERE finished = 0 ORDER BY rowid DESC",
        )
        .fetch_all(&mut *conn)
        .await?
        .into_iter()
        .map(|row| row.get::<String, _>(0))
        .collect::<Vec<_>>();

        Ok(transactions)
    }

    // returns all spent utxos database index
    pub(crate) async fn get_pending_spent_utxos(&self) -> Result<Vec<i64>> {
        let mut conn = self.pool.acquire().await?;

        let spent_utxos =
            sqlx::query("SELECT utxo_id FROM wallet_state_pending_ids WHERE finished = 0")
                .fetch_all(&mut *conn)
                .await?
                .into_iter()
                .map(|row| row.get::<i64, _>(0))
                .collect::<Vec<_>>();

        Ok(spent_utxos)
    }

    // remove pending and returns transaction id
    pub(crate) async fn try_remove_pending_by_utxo_id(
        &self,
        tx: &mut SqliteConnection,
        id: i64,
    ) -> Result<Option<String>> {
        let txids = sqlx::query("SELECT txid FROM wallet_state_pending_ids WHERE utxo_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|row| row.get::<String, _>(0))
            .collect::<Vec<_>>();

        let mut remove = None;
        for txid in txids {
            sqlx::query("UPDATE wallet_state_pending SET finished = 1 WHERE id = ?")
                .bind(&txid)
                .execute(&mut *tx)
                .await?;

            sqlx::query("UPDATE wallet_state_pending_ids SET finished = 1 WHERE txid = ?")
                .bind(&txid)
                .execute(&mut *tx)
                .await?;
            remove = Some(txid);
        }

        Ok(remove)
    }

    pub(crate) async fn try_clean_pending_by_utxo(
        &self,
        tx: &mut SqliteConnection,
        utxoid: Vec<i64>,
    ) -> Result<()> {
        let transactions = match self.get_pending_transactions(&mut *tx).await {
            Ok(transactions) => transactions,
            Err(err) => {
                error!("Error getting pending transactions: {}", err);
                vec![]
            }
        };

        for transaction in transactions {
            if let Some(_utxo) = transaction.2.iter().find(|id| utxoid.contains(id)) {
                //should be deleted
                let txid = transaction.0;
                sqlx::query("DELETE FROM wallet_state_pending WHERE id = ?")
                    .bind(&txid)
                    .execute(&mut *tx)
                    .await?;

                sqlx::query("DELETE FROM wallet_state_pending_ids WHERE txid = ?")
                    .bind(&txid)
                    .execute(&mut *tx)
                    .await?;
            }
        }

        Ok(())
    }
}
