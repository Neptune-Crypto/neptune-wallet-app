use std::collections::HashMap;
use std::range::Range;

use anyhow::Result;
use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
use neptune_primitives::timestamp::Timestamp;
use neptune_wallet::address::KeyType;
use serde::Serialize;
use strum::IntoEnumIterator;

use super::wallet_state_table::UtxoDbData;

/// Amounts received by a set of keys, as lossless display strings.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub(crate) struct AddressTotals {
    pub received: String,
    pub unspent: String,
    /// Unspent, but not spendable now because of a time lock.
    pub locked: String,
    pub utxo_count: u32,
    pub last_received_height: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AddressBalance {
    pub key_type: KeyType,
    pub key_index: u64,
    #[serde(flatten)]
    pub totals: AddressTotals,
}

/// Per-key UTXO totals of the wallet.
///
/// While a send is pending, the summed `unspent` exceeds the displayed
/// balance: the pending inputs are still unspent here, and the pending change
/// is not attributed to any key until it is confirmed.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct AddressBalances {
    /// Non-symmetric keys with at least one UTXO, ordered by key type and
    /// index.
    pub by_key: Vec<AddressBalance>,
    /// All symmetric keys: change and the wallet's own mining rewards.
    pub internal: AddressTotals,
    /// UTXOs that match no known or future key.
    pub unattributed: AddressTotals,
}

#[derive(Default)]
struct Sums {
    received: i128,
    unspent: i128,
    locked: i128,
    utxo_count: u32,
    last_received_height: Option<u64>,
}

impl Sums {
    fn add(&mut self, utxo: &UtxoDbData, now: Timestamp) {
        let coin = &utxo.recovery_data.utxo;
        let amount = coin.get_native_currency_amount().to_nau();
        self.received += amount;
        if utxo.spent_in_block.is_none() {
            self.unspent += amount;
            if !coin.can_spend_at(now) {
                self.locked += amount;
            }
        }
        self.utxo_count += 1;
        let height = utxo.confirmed_in_block.block_height;
        self.last_received_height = self.last_received_height.max(Some(height));
    }

    fn totals(&self) -> AddressTotals {
        let display = |nau| NativeCurrencyAmount::from_nau(nau).display_lossless();
        AddressTotals {
            received: display(self.received),
            unspent: display(self.unspent),
            locked: display(self.locked),
            utxo_count: self.utxo_count,
            last_received_height: self.last_received_height,
        }
    }
}

impl super::WalletState {
    /// Return the wallet's UTXO totals per receiving key.
    pub(crate) async fn address_balances(&self) -> Result<AddressBalances> {
        let mut owner = HashMap::new();
        for key_type in KeyType::iter() {
            let end = self.ephemeral_key_index(key_type) + self.num_future_keys();
            for (idx, key) in self.keys(Range { start: 0, end }, key_type) {
                owner
                    .entry(key.privacy_preimage())
                    .or_insert((key_type, idx));
            }
        }

        let now = Timestamp::now();
        let mut by_key: HashMap<(KeyType, u64), Sums> = HashMap::new();
        let mut internal = Sums::default();
        let mut unattributed = Sums::default();
        for utxo in self.get_utxos().await? {
            let sums = match owner.get(&utxo.recovery_data.receiver_preimage) {
                Some((KeyType::Symmetric, _)) => &mut internal,
                Some(&key) => by_key.entry(key).or_default(),
                None => &mut unattributed,
            };
            sums.add(&utxo, now);
        }

        let type_order = |t: KeyType| KeyType::iter().position(|x| x == t);
        let mut by_key: Vec<_> = by_key
            .into_iter()
            .map(|((key_type, key_index), sums)| AddressBalance {
                key_type,
                key_index,
                totals: sums.totals(),
            })
            .collect();
        by_key.sort_by_key(|b| (type_order(b.key_type), b.key_index));

        Ok(AddressBalances {
            by_key,
            internal: internal.totals(),
            unattributed: unattributed.totals(),
        })
    }
}

#[cfg(test)]
mod tests {
    use neptune_primitives::network::Network;
    use neptune_wallet::address::symmetric_key::SymmetricKey;
    use neptune_wallet::address::SpendingKey;
    use neptune_wallet::wallet_entropy::WalletEntropy;
    use tracing_test::traced_test;

    use super::*;
    use crate::config::wallet::ScanConfig;
    use crate::config::wallet::WalletConfig;
    use crate::tests::test_devnet_wallet;
    use crate::tests::test_wallet_db;
    use crate::tests::wallet_block_from_test_data;
    use crate::wallet::tests::block_guessed_by;
    use crate::wallet::tests::template_with_guesser_fee;
    use crate::wallet::WalletState;

    fn coins(nau: i128) -> String {
        NativeCurrencyAmount::from_nau(nau).display_lossless()
    }

    fn nau(amount: &str) -> i128 {
        NativeCurrencyAmount::coins_from_str(amount)
            .unwrap()
            .to_nau()
    }

    fn balance_of(balances: &AddressBalances, key_type: KeyType, idx: u64) -> &AddressTotals {
        &balances
            .by_key
            .iter()
            .find(|b| b.key_type == key_type && b.key_index == idx)
            .unwrap_or_else(|| panic!("no balance for {key_type} {idx}"))
            .totals
    }

    /// Devnet wallet after blocks 38260..38290: gen key 1 received 0.75 that
    /// was later spent, and gen key 2 received 0.5.
    async fn wallet_after_spend_and_change() -> WalletState {
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 100,
                start_height: 0,
                ..Default::default()
            },
            network: Network::Main,
        };
        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config, &db_path).await.unwrap();
        for height in 38260..38290 {
            let block = wallet_block_from_test_data(height).unwrap();
            wallet_state.update_new_tip(&block).await.unwrap();
        }
        wallet_state
    }

    #[traced_test]
    #[tokio::test]
    async fn balances_follow_spend_and_change() {
        let wallet_state = wallet_after_spend_and_change().await;
        let balances = wallet_state.address_balances().await.unwrap();

        let gen1 = balance_of(&balances, KeyType::Generation, 1);
        assert_eq!(coins(nau("0.75")), gen1.received);
        assert_eq!(coins(0), gen1.unspent);
        assert_eq!(1, gen1.utxo_count);

        let gen2 = balance_of(&balances, KeyType::Generation, 2);
        assert_eq!(coins(nau("0.5")), gen2.received);
        assert_eq!(coins(nau("0.5")), gen2.unspent);
        assert_eq!(1, gen2.utxo_count);

        let total_unspent: i128 = wallet_state
            .get_utxos()
            .await
            .unwrap()
            .iter()
            .filter(|u| u.spent_in_block.is_none())
            .map(|u| u.recovery_data.utxo.get_native_currency_amount().to_nau())
            .sum();
        let summed_unspent: i128 = balances
            .by_key
            .iter()
            .map(|b| &b.totals)
            .chain([&balances.internal, &balances.unattributed])
            .map(|t| nau(&t.unspent))
            .sum();
        assert_eq!(total_unspent, summed_unspent);

        let (_, _, account_balance) = wallet_state.get_all_balance().await.unwrap();
        assert_eq!(account_balance.to_nau(), summed_unspent);
    }

    #[traced_test]
    #[tokio::test]
    async fn guesser_reward_shows_under_its_key() {
        let wallet_state = test_devnet_wallet().await;
        let key = WalletEntropy::devnet_wallet().nth_spending_key(KeyType::Generation, 3);
        let block = block_guessed_by(&template_with_guesser_fee(), &key);
        wallet_state.update_new_tip(&block).await.unwrap();

        let num_rewards = block.kernel.guesser_fee_utxos().unwrap().len();
        let balances = wallet_state.address_balances().await.unwrap();
        let gen3 = balance_of(&balances, KeyType::Generation, 3);
        assert_eq!(num_rewards, gen3.utxo_count as usize);

        let now = Timestamp::now();
        let locked: i128 = wallet_state
            .get_utxos()
            .await
            .unwrap()
            .iter()
            .filter(|u| !u.recovery_data.utxo.can_spend_at(now))
            .map(|u| u.recovery_data.utxo.get_native_currency_amount().to_nau())
            .sum();
        assert_eq!(coins(locked), gen3.locked);

        // A symmetric key's reward is internal, not listed per key.
        let wallet_state = test_devnet_wallet().await;
        let key = WalletEntropy::devnet_wallet().nth_spending_key(KeyType::Symmetric, 1);
        let block = block_guessed_by(&template_with_guesser_fee(), &key);
        wallet_state.update_new_tip(&block).await.unwrap();

        let balances = wallet_state.address_balances().await.unwrap();
        assert!(balances.by_key.is_empty());
        assert_eq!(num_rewards, balances.internal.utxo_count as usize);
    }

    #[traced_test]
    #[tokio::test]
    async fn spent_coins_are_never_locked() {
        let wallet_state = wallet_after_spend_and_change().await;
        let balances = wallet_state.address_balances().await.unwrap();

        let gen1 = balance_of(&balances, KeyType::Generation, 1);
        assert_eq!(coins(0), gen1.locked);
    }

    #[traced_test]
    #[tokio::test]
    async fn malformed_symmetric_reward_is_internal() {
        let config = |recover_from_sym_digest_keys| WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 100,
                start_height: 0,
                recover_from_sym_digest_keys,
            },
            network: Network::Main,
        };
        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config(true), &db_path).await.unwrap();

        // The malformed key's seed is the privacy preimage of the real one.
        let sym1 = WalletEntropy::devnet_wallet().nth_spending_key(KeyType::Symmetric, 1);
        let malformed: SpendingKey = SymmetricKey::from_seed(sym1.privacy_preimage()).into();
        let block = block_guessed_by(&template_with_guesser_fee(), &malformed);
        wallet_state.update_new_tip(&block).await.unwrap();

        let num_rewards = block.kernel.guesser_fee_utxos().unwrap().len();
        let balances = wallet_state.address_balances().await.unwrap();
        assert!(balances.by_key.is_empty());
        assert_eq!(num_rewards, balances.internal.utxo_count as usize);
        assert_eq!(0, balances.unattributed.utxo_count);

        // Without recovery of malformed keys, the same UTXOs match no key.
        let wallet_state = WalletState::new(config(false), &db_path).await.unwrap();
        let balances = wallet_state.address_balances().await.unwrap();
        assert!(balances.by_key.is_empty());
        assert_eq!(0, balances.internal.utxo_count);
        assert_eq!(num_rewards, balances.unattributed.utxo_count as usize);
    }
}
