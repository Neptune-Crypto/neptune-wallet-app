# vxb neptune wallet

vxb neptune wallet is a cross-platform wallet for [neptunecash](https://github.com/Neptune-Crypto/neptune-core).

## Download

You can get compiled installer and docs here: <https://github.com/VxBlocks/vxb_neptune_wallet>

## Development

Refer to [neptune-wallet-core](https://github.com/VxBlocks/neptune-wallet-core) for server side source code. or read [self hosted server](#self-hosted-server) to run self hosted server.

### Prerequisites

1. System Dependencies
    - Linux
    - macOS Catalina (10.15) and later
    - Windows 7 and later
2. Rust

3. Node.js

### Dependencies

Refer to [tauri](https://tauri.app/start/prerequisites)

### Project structure

- `src` frontend
- `src-tauri` backend
  - `config`
  - `logger`
  - `os`
  - `rpc` rpc server for futher use on browser
  - `rpc_client` rpc_client to interact with rpc server (cli)
  - `wallet` wallet core
  - `service` state management
  - `session_store` session store for frontend
  - `cli` cli entrypoint
  - `gui` gui entrypoint
- `leveldb-sys` leveldb stub since we dont use it and it is not compatible with cargo-xwin

### Build locally, on an Ubuntu machine

```bash
 # Install task
curl -1sLf 'https://dl.cloudsmith.io/public/task/task/setup.deb.sh' | sudo -E bash

# Install node package manager
sudo apt install npm

# Install and switch to latest node version
sudo npm install n -g
sudo n stable

# Install yarn
sudo npm install -g yarn

# Install JS dependencies
yarn install

# Install system dependencies
sudo apt install libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libfuse2 librsvg2-dev libwebkit2gtk-4.1-dev build-essential

# Build binaries
task build
```

Run the newly built appimage
```bash
chmod +x ./src-tauri/target/release/bundle/appimage/NeptuneWallet_<version>_amd64.AppImage
./src-tauri/target/release/bundle/appimage/NeptuneWallet_<version>_amd64.AppImage
```

NOTE: windows version can only be built on linux with cargo-xwin.

NOTE: android version can be compiled now, but the frontend is not ready, you can only use android app on tablet or landscape mode.

### Self-hosted server

The wallet use a patched version of `neptune-core` to support rest api.

To run a self hosted server, you need to:

```bash
git clone https://github.com/VxBlocks/neptune-wallet-core -b wallet
cd neptune-wallet-core
cargo run --release -- --rest-port 9800
```

Then you can set your server url in the wallet settings.
