clippy:
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
	yarn lint

format:
	cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

happy: clippy format test check-version

install:
	yarn install
	task build

VERSION := $(shell sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
check-version:
	@echo "Cargo version: $(VERSION)"
	@PKG_VERSION=$$(jq -r '.version' package.json); \
	if [ "$$PKG_VERSION" != "$(VERSION)" ]; then \
		echo "❌ Version mismatch!"; \
		echo "Cargo.toml: $(VERSION)"; \
		echo "package.json: $$PKG_VERSION"; \
		exit 1; \
	else \
		echo "✅ Versions match"; \
	fi

test:
	yarn install
	yarn check
	yarn install --frozen-lockfile
	yarn test
	cargo nextest --manifest-path src-tauri/Cargo.toml r
	RUSTDOCFLAGS="-D warnings" cargo doc --manifest-path src-tauri/Cargo.toml --no-deps --workspace --document-private-items
