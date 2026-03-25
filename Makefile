clippy:
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
	yarn lint

format:
	cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

happy: clippy format test

install:
	yarn install
	task build

test:
	yarn install
	yarn check
	yarn test
	cargo nextest --manifest-path src-tauri/Cargo.toml r
	RUSTDOCFLAGS="-D warnings" cargo doc --manifest-path src-tauri/Cargo.toml --no-deps --workspace --document-private-items
