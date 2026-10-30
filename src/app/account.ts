import { h, icon } from "./dom";
import { signedInUser, signOut, type AuthUser } from "./signin";

/**
 * The account as this device knows it: the name and picture the user chose (kept in this browser,
 * per account) and the accounts that signed in here before, so switching back is one tap.
 */

export interface Profile {
  name?: string;
  avatar?: string;
  color?: string;
  about?: string;
}

interface SavedAccount {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  via: string;
  at: number;
}

const PROFILE = (id: string) => `focus.profile.${id}`;
const ACCOUNTS = "focus.accounts";
const COLORS = ["#1d1d1d", "#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#0090ff", "#8e4ec6", "#d6409f"];

const read = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the change lasts until reload
  }
};

export const profileOf = (id: string): Profile => read<Profile>(PROFILE(id), {});

/** The signed-in user with the name and picture they chose here. */
export function displayUser(): (AuthUser & { color?: string }) | null {
  const user = signedInUser();
  if (!user) return null;
  const p = profileOf(user.id);
  return { ...user, name: p.name?.trim() || user.name, avatar: p.avatar || user.avatar, color: p.color };
}

/** Remembers the signed-in account on this device. Call once the app knows who is signed in. */
export function rememberAccount(): void {
  const u = displayUser();
  if (!u) return;
  const list = read<SavedAccount[]>(ACCOUNTS, []).filter((a) => a.id !== u.id);
  write(ACCOUNTS, [{ id: u.id, name: u.name, email: u.email, avatar: u.avatar, via: u.via, at: Date.now() }, ...list].slice(0, 6));
}

export function avatarEl(u: { name: string; avatar?: string; color?: string }, size = 22): HTMLElement {
  if (u.avatar) return h("img", { class: "acct-avatar", src: u.avatar, alt: "", width: size, height: size, style: `width:${size}px;height:${size}px` });
  return h("span", { class: "acct-avatar", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${u.color ?? "#1d1d1d"}` }, (u.name || "?").slice(0, 1).toUpperCase());
}

/** A picture the user picked, cropped square and shrunk to 160px so it fits in local storage. */
async function squareAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 160, 160);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.85);
}

/** Sign out and start signing in with a saved account's provider. */
async function switchTo(a: SavedAccount): Promise<void> {
  await fetch("/api/auth?a=logout", { method: "POST" }).catch(() => undefined);
  if (a.via === "github" || a.via === "google") location.href = `/api/auth?a=${a.via}`;
  else location.href = `/app?email=${encodeURIComponent(a.email ?? "")}`;
}

export function accountSection(rerender: () => void): HTMLElement {
  const user = signedInUser();
  const card = h("section", { class: "card set-card acct-card" }, h("h3", { class: "set-title" }, "Account"));
  if (!user) {
    card.append(h("p", { class: "page-lede set-lede" }, import.meta.env.VITE_ARTIFACT === "1" ? "Accounts live on the website, focus-agents.vercel.app. Here your chats stay in this browser." : "You're using Focus without an account. Your chats stay in this browser."));
    return card;
  }
  const p = profileOf(user.id);
  const save = (next: Profile) => {
    write(PROFILE(user.id), { ...profileOf(user.id), ...next });
    rememberAccount();
  };
  const me = displayUser()!;
  const file = h("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      save({ avatar: await squareAvatar(f) });
      rerender();
    } catch {
      alert("This picture couldn't be read. Try a PNG or JPEG.");
    }
  });
  const name = h("input", { type: "text", value: p.name ?? "", placeholder: user.name, maxlength: 40, "aria-label": "Display name" });
  name.addEventListener("change", () => save({ name: name.value.trim() }));
  const about = h("input", { type: "text", value: p.about ?? "", placeholder: "A few words for Focus about you (optional)", maxlength: 160, "aria-label": "About you" });
  about.addEventListener("change", () => save({ about: about.value.trim() }));
  const colors = h(
    "div",
    { class: "acct-colors", role: "radiogroup", "aria-label": "Avatar colour" },
    ...COLORS.map((c) =>
      h("button", {
        type: "button",
        class: `acct-color${(p.color ?? "#1d1d1d") === c ? " on" : ""}`,
        style: `background:${c}`,
        "aria-label": c,
        onclick: () => {
          save({ color: c, avatar: "" });
          rerender();
        },
      }),
    ),
  );
  card.append(
    h(
      "div",
      { class: "acct-head" },
      h("button", { class: "acct-pic", type: "button", title: "Change picture", onclick: () => file.click() }, avatarEl(me, 64), h("span", { class: "acct-pic-edit" }, icon("edit", 14))),
      h("div", { class: "acct-id" }, h("strong", {}, me.name), h("small", {}, `${user.email ?? ""}${user.email ? " · " : ""}${user.via === "github" ? "GitHub" : user.via === "google" ? "Google" : "Email"}`)),
      file,
    ),
    h("label", { class: "field" }, h("span", {}, "Name"), name),
    h("label", { class: "field" }, h("span", {}, "About you"), about),
    h("div", { class: "field" }, h("span", {}, "Colour (without a picture)"), colors),
    h(
      "div",
      { class: "acct-actions" },
      p.avatar ? h("button", { class: "btn-ghost", type: "button", onclick: () => (save({ avatar: "" }), rerender()) }, "Remove picture") : null,
      h("button", { class: "btn-ghost", type: "button", onclick: () => void signOut() }, "Sign out"),
    ),
  );
  const saved = read<SavedAccount[]>(ACCOUNTS, []).filter((a) => a.id !== user.id);
  if (saved.length)
    card.append(
      h("h4", { class: "acct-sub" }, "Saved on this device"),
      ...saved.map((a) =>
        h(
          "div",
          { class: "set-row acct-row" },
          avatarEl(a, 32),
          h("div", { class: "set-row-text" }, h("strong", {}, a.name), h("small", {}, a.email ?? a.via)),
          h("button", { class: "btn-ghost sm", type: "button", onclick: () => void switchTo(a) }, "Switch"),
          h(
            "button",
            {
              class: "icon-btn sm",
              type: "button",
              "aria-label": `Forget ${a.name}`,
              onclick: () => {
                write(ACCOUNTS, read<SavedAccount[]>(ACCOUNTS, []).filter((x) => x.id !== a.id));
                rerender();
              },
            },
            icon("close", 14),
          ),
        ),
      ),
    );
  return card;
}
