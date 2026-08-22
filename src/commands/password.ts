import { invoke } from "@tauri-apps/api/core";

export async function input_password(password: string) {
  await invoke("input_password", { password: password });
}

export async function set_password(old_password: String, password: string) {
  await invoke("set_password", {
    password: password,
    oldPassword: old_password,
  });
}
export async function has_password(): Promise<boolean> {
  return await invoke("has_password", {});
}

// Persists the password chosen in first-run onboarding, tolerating one
// stored by an earlier attempt: the wizard keeps a single password per
// session, so the stored value also serves as the old password.
export async function set_onboarding_password(password: string) {
  if (await has_password()) {
    await set_password(password, password);
  } else {
    await set_password("", password);
  }
}

export async function try_password(): Promise<boolean> {
  return await invoke("try_password", {});
}

export async function lock_wallet() {
  await invoke("lock_wallet", {});
}
