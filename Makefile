clippy:
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
	yarn lint

format:
	cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

happy: clippy format test

install:
	task build

test:
	cargo nextest --manifest-path src-tauri/Cargo.toml r
	RUSTDOCFLAGS="-D warnings" cargo doc --manifest-path src-tauri/Cargo.toml --no-deps --workspace --document-private-items
