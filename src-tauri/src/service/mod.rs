pub(crate) mod app;
pub(crate) mod state;

use once_cell::sync::Lazy;

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

#[allow(unused)]
pub(crate) fn unmanage<T: Send + Sync + 'static>() -> Option<T> {
    unsafe { STATE_MANAGER.unmanage() }
}

pub(crate) fn get_state<T: Send + Sync + 'static>() -> state::State<'static, T> {
    STATE_MANAGER.get()
}

pub(crate) fn try_get_state<T: Send + Sync + 'static>() -> Option<state::State<'static, T>> {
    STATE_MANAGER.try_get()
}
