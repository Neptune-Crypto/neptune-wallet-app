use std::env;
use std::path::Path;
use std::path::PathBuf;

use rand::distr::Alphanumeric;
use rand::distr::SampleString;

/// Create a database path in a randomly named directory so filesystem-bound
/// tests can run in parallel.
///
/// If this is not done, parallel execution of unit tests will fail as they each
/// hold a lock on the database.
fn unit_test_dir() -> PathBuf {
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
pub(crate) async fn create_wallet_db() -> PathBuf {
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
