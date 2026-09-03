import { getWallets } from "@/commands/wallet";
import { Contact } from "@/database/types/contact";
import { getContactList } from "@/utils/storage";
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { ContactState } from "../types";
const initialState: ContactState = {
  loadingContacts: false,
  contactsLoaded: false,
  contacts: [],
};
const contactSlice = createSlice({
  name: "contact",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(queryAllContacts.pending, (state) => {
      state.loadingContacts = true;
    });
    builder.addCase(queryAllContacts.fulfilled, (state, action) => {
      state.loadingContacts = false;
      state.contactsLoaded = true;
      state.contacts = action.payload.data;
    });
    // A failure still counts as settled, so views stop waiting; contacts are
    // left untouched, keeping the last known list.
    builder.addCase(queryAllContacts.rejected, (state) => {
      state.loadingContacts = false;
      state.contactsLoaded = true;
    });
  },
});

export const queryAllContacts = createAsyncThunk<{ data: Contact[] }>(
  "/api/contact/queryAllContacts",
  async () => {
    const contactList = await getContactList();
    let newContactList = await merageAddress(contactList);
    return {
      data: newContactList,
    };
  }
);

async function merageAddress(contactList: Contact[]) {
  let newContactList = contactList ?? ([] as Contact[]);
  try {
    const res = await getWallets();
    if (res && res.length > 0) {
      for (let i = 0; i < res.length; i++) {
        let ownerWallet = res[i];
        newContactList.push({
          aliasName: ownerWallet.name,
          address: ownerWallet.address,
          type: "owner",
          remark: "",
          createdTime: 0,
        });
      }
    }
  } catch (error) {}

  return newContactList;
}

export const {} = contactSlice.actions;

export default contactSlice.reducer;
