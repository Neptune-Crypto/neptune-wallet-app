pub(crate) mod app;
pub(crate) mod state;

use std::time::Duration;

use once_cell::sync::Lazy;
use tracing::error;

pub(crate) static STATE_MANAGER: Lazy<state::StateManager> = Lazy::new(state::StateManager::new);

pub(crate) fn manage<T: Send + Sync + 'static>(value: T) -> Option<state::State<'static, T>> {
    if !STATE_MANAGER.set(value) {
        return Some(STATE_MANAGER.get());
    }
    None
}

pub(crate) fn manage_or_replace<T: Send + Sync + 'static>(value: T) {
    unsafe {
        STATE_MANAGER.unmanage::<T>();
    }
    STATE_MANAGER.set(value);
}

pub(crate) fn get_state<T: Send + Sync + 'static>() -> state::State<'static, T> {
    STATE_MANAGER.get()
}

pub(crate) fn try_get_state<T: Send + Sync + 'static>() -> Option<state::State<'static, T>> {
    STATE_MANAGER.try_get()
}

pub(crate) async fn try_get_state_repeated<T: Send + Sync + 'static>(
    num_retries: usize,
    interval: Duration,
    caller: &str,
) -> Option<state::State<'static, T>> {
    let mut fail_count = 0;
    let mut state = crate::service::try_get_state::<T>();
    while state.is_none() && num_retries <= 10 {
        error!("Failed to state for {caller}. Fail count: {fail_count} / {num_retries}");
        tokio::time::sleep(interval).await;
        state = crate::service::try_get_state::<T>();
        fail_count += 1;
    }

    state
}
