use std::env;
use std::fs;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::path::Path;
use std::path::PathBuf;

use neptune_primitives::network::Network;
use neptune_rpc_api::model::wallet::block::RpcWalletBlock;
use neptune_wallet::incoming_utxo::IncomingUtxoRecoveryData;
use neptune_wallet::wallet_entropy::WalletEntropy;
use rand::distr::Alphanumeric;
use rand::distr::SampleString;

use crate::config::wallet::ScanConfig;
use crate::config::wallet::WalletConfig;
use crate::wallet::wallet_block::WalletBlock;
use crate::wallet::WalletState;

pub(crate) async fn test_devnet_wallet() -> WalletState {
    let network = Network::Main;
    let config = WalletConfig {
        id: 0,
        key: WalletEntropy::devnet_wallet(),
        scan_config: ScanConfig {
            num_keys: 20,
            start_height: 0,
            ..Default::default()
        },
        network,
    };

    let db_path = test_wallet_db().await;

    WalletState::new(config, &db_path).await.unwrap()
}

/// Create a database path in a randomly named directory so filesystem-bound
/// tests can run in parallel.
///
/// If this is not done, parallel execution of unit tests will fail as they each
/// hold a lock on the database.
pub(crate) fn unit_test_dir() -> PathBuf {
    let mut rng = rand::rng();
    let user = env::var("USER").unwrap_or_else(|_| "default".to_string());
    let pid = std::process::id();

    let path: PathBuf = env::temp_dir()
        .join(format!("neptune-vxb-wallet-unit-tests-{user}-{pid}"))
        .join(Path::new(&Alphanumeric.sample_string(&mut rng, 16)));

    path
}

/// Create a directory for a unit test database, and return the full path of
/// the wallet database file that can be created in that directory.
pub(crate) async fn test_wallet_db() -> PathBuf {
    let dir = unit_test_dir();
    tokio::fs::create_dir_all(&dir).await.unwrap();
    dir.join("wallet.db")
}

/// Return a directory path that can be used to store a snapshot of blocks.
pub(crate) async fn snapshot_dir_path() -> PathBuf {
    let dir = unit_test_dir();
    tokio::fs::create_dir_all(&dir).await.unwrap();
    dir
}

pub(crate) fn wallet_block_from_test_data(block_height: u64) -> Option<WalletBlock> {
    let file_path = format!("test_data/block_{}.bin", block_height);

    let file_bytes = fs::read(file_path).ok()?;

    let rpc_block: RpcWalletBlock = bincode::deserialize(&file_bytes).ok()?;

    Some(rpc_block.into())
}

pub(crate) fn load_incoming_randomness(file_name: &str) -> Vec<IncomingUtxoRecoveryData> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("test_data");
    path.push(file_name);

    let file =
        File::open(&path).unwrap_or_else(|_| panic!("Failed to open test data file at {:?}", path));
    let reader = BufReader::new(file);

    let mut incoming_utxos: Vec<IncomingUtxoRecoveryData> = Vec::new();
    for (line_number, line) in reader.lines().enumerate() {
        let line = line.expect("Failed to read line from test data");

        if line.trim().is_empty() {
            continue;
        }

        let utxo: IncomingUtxoRecoveryData = serde_json::from_str(&line).unwrap_or_else(|e| {
            panic!(
                "Failed to deserialize JSON at line {}: {}",
                line_number + 1,
                e
            )
        });

        incoming_utxos.push(utxo);
    }

    incoming_utxos
}
