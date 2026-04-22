# Vxb neptune wallet

vxb neptune wallet is a cross-platform wallet for [neptunecash](https://github.com/Neptune-Crypto/neptune-core).

## Development

Refer to [neptune-wallet-core](https://github.com/Neptune-Crypto/neptune-core) for server side source code. or read [self hosted server](#self-hosted-server) to run self hosted server.

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

### Run in development mode, on a Debian/Ubuntu system

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

# Open in dev mode
yarn tauri dev
```

To compile release binaries, use `task build`. You may have to remove the public
keys from `tauri.conf.json` before this works fully though. Otherwise you'll
likely get an error message that the binaries could not be signed.

### Self-hosted server

The wallet uses the standard version of `neptune-core` to support rest api.

To run a self hosted server, you can:

```bash
git clone https://github.com/Neptune-Crypto/neptune-core
cd neptune-wallet-core
cargo run --release -- --listen-rpc=<public-ip-or-localhost>:9797 --rpc-modules "node,chain,wallet,archival"
```

Then you can set your server url in the wallet settings. No secrets are shared between server and
your wallet, so a malicious server will not be able to steal your funds. Nor will
someone listening in between be able to steal anything. Should you want to encrypt the connection between your wallet and your server anyway, you have to setup a reverse proxy yourself. `caddy` is a very fast way to achieve that.
