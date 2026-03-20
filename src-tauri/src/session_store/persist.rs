use std::path::Path;

use itertools::Itertools;
use sqlx::Column;
use sqlx::Row;
use sqlx::SqlitePool;
use sqlx::TypeInfo;
use sqlx_migrator::Info;
use sqlx_migrator::Migrate;
use sqlx_migrator::Migrator;
use sqlx_migrator::Plan;

struct CreateContactsMigration;

sqlx_migrator::sqlite_migration!(
    CreateContactsMigration,
    "contacts",
    "create_contacts_table",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aliasName TEXT NOT NULL,
            address TEXT NOT NULL,
            type TEXT,
            remark TEXT,
            createdTime INTEGER
        );", //up
        "DROP TABLE contacts" //down
    )]
);

struct CreateExecutionHistoryMigration;

sqlx_migrator::sqlite_migration!(
    CreateExecutionHistoryMigration,
    "history",
    "create_execution_history",
    sqlx_migrator::vec_box![],
    sqlx_migrator::vec_box![(
        "CREATE TABLE IF NOT EXISTS execution_history(
            txid          TEXT         PRIMARY KEY,
            timestamp     INTEGER      NOT NULL,
            height        INTEGER      NOT NULL,
            addressId     INTEGER      NOT NULL,
            address       TEXT         NOT NULL,
            fee           TEXT         NOT NULL,
            priorityFee   TEXT         NOT NULL,
            status        TEXT,
            batchOutput   TEXT
        );", //up
        "DROP TABLE execution_history" //down
    )]
);

#[derive(Debug, Clone)]
pub(crate) struct PersisStore {
    db: SqlitePool,
}

impl PersisStore {
    pub(crate) async fn new(data_dir: &Path) -> anyhow::Result<Self> {
        let db_path = data_dir.join("store.db");

        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);

        let pool = sqlx::SqlitePool::connect_with(options)
            .await
            .map_err(|err| anyhow::anyhow!("Could not connect to database: {err}"))?;

        let store = Self { db: pool };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> anyhow::Result<()> {
        let mut migrator = Migrator::default();
        // Adding migration can fail if another migration with same app and name and different values gets added
        // Adding migrations add its parents, replaces and not before as well
        migrator.add_migration(Box::new(CreateExecutionHistoryMigration))?;
        migrator.add_migration(Box::new(CreateContactsMigration))?;

        let mut conn = self.db.acquire().await?;
        // use apply all to apply all pending migration
        migrator.run(&mut *conn, &Plan::apply_all()).await?;

        Ok(())
    }

    pub(crate) async fn execute(
        &self,
        query: &str,
        params: Vec<serde_json::Value>,
        read_only: bool,
    ) -> Result<Vec<serde_json::Value>, sqlx::Error> {
        let query = query.trim();

        if query.split(';').filter(|s| !s.is_empty()).count() > 1 {
            return Err(sqlx::Error::InvalidArgument(
                "Multiple SQL statements are not allowed".to_string(),
            ));
        }

        let legal_commands = if read_only {
            vec!["SELECT"]
        } else {
            vec!["SELECT", "INSERT", "DELETE"]
        };

        let starts_with_legal_value = legal_commands
            .iter()
            .any(|command| query.to_ascii_uppercase().starts_with(command));
        if !starts_with_legal_value {
            return Err(sqlx::Error::InvalidArgument(format!(
                "This executor only allows for the use of these commands: [{}]",
                legal_commands.iter().join(",")
            )));
        }

        let mut query = sqlx::query::<sqlx::Sqlite>(query);

        for val in params {
            query = match val {
                serde_json::Value::String(s) => query.bind(s),
                serde_json::Value::Number(n) => query.bind(n.as_f64().unwrap_or(0.0)),
                serde_json::Value::Bool(b) => query.bind(b),
                serde_json::Value::Null => query.bind(None::<String>),
                _ => query.bind(val.to_string()),
            };
        }

        let res = query.fetch_all(&self.db).await?;
        let json = res
            .into_iter()
            .map(|row| {
                let col = row.columns();
                let mut json_row = serde_json::Map::new();
                for col in col.iter() {
                    let type_info = col.type_info();
                    let name = col.name();
                    match type_info.name() {
                        "TEXT" => {
                            let value = row.get::<String, _>(name);
                            json_row.insert(name.to_owned(), serde_json::Value::String(value));
                        }
                        "INTEGER" => {
                            let value = row.get::<i64, _>(name);
                            json_row
                                .insert(name.to_owned(), serde_json::Value::Number(value.into()));
                        }
                        "NULL" => {
                            json_row.insert(name.to_owned(), serde_json::Value::Null);
                        }
                        "BLOB" => {
                            let value = row.get::<Vec<u8>, _>(name);

                            json_row.insert(
                                name.to_owned(),
                                serde_json::Value::String(hex::encode(value)),
                            );
                        }
                        "BOOLEAN" => {
                            let value = row.get::<bool, _>(name);
                            json_row.insert(name.to_owned(), serde_json::Value::Bool(value));
                        }
                        "REAL" => {
                            let value = row.get::<f64, _>(name);
                            let number = serde_json::Number::from_f64(value).unwrap();
                            json_row.insert(name.to_owned(), serde_json::Value::Number(number));
                        }
                        _ => {}
                    }
                }
                serde_json::Value::Object(json_row)
            })
            .collect::<Vec<_>>();

        Ok(json)
    }
}
