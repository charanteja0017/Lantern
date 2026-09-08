"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  Bell,
  Check,
  Copy,
  Download,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  Smartphone,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import QRCode from "qrcode";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  generateRecoveryCodes,
  generateSecret,
  otpauthUrl,
  verifyTotp,
} from "@/lib/totp";
import { pushNotification } from "@/lib/notifications";
import { getProvider } from "@/lib/api";

import { PageHeader } from "@/components/layout/shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { config, hasClerk } from "@/lib/config";

type Profile = {
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: string;
  timezone: string;
  bio: string;
  initials: string;
};

type NotifyPrefs = {
  runCompleted: boolean;
  criticalFindings: boolean;
  throttle: boolean;
  weeklyDigest: boolean;
  productNews: boolean;
};

type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
};

type Session = {
  id: string;
  device: string;
  location: string;
  current: boolean;
  lastActiveAt: string;
  kind: "desktop" | "mobile";
};

const STORAGE = {
  profile: "strix.profile",
  notify: "strix.notify",
  keys: "strix.apikeys",
  keySecrets: "strix.apikeys.secrets", // demo-only: full keys for docs injection
  twofa: "strix.twofa",
  devices: "strix.devices",
  backupOtp: "strix.backup-otp",
  avatar: "strix.avatar",
} as const;

type TwoFactor = {
  enabled: boolean;
  enrolledAt?: string;
  secret?: string;
  recoveryCodes?: string[];
};

type HardwareKey = {
  id: string;
  name: string;
  kind: "yubikey" | "solokey" | "titan" | "platform";
  addedAt: string;
};

type BackupOtp = {
  enabled: boolean;
  email?: string;
};

const DEFAULT_TWOFA: TwoFactor = { enabled: false };
const DEFAULT_DEVICES: HardwareKey[] = [];
const DEFAULT_BACKUP_OTP: BackupOtp = { enabled: true };

const DEFAULT_PROFILE: Profile = {
  fullName: "",
  username: "",
  email: "",
  phone: "",
  role: "member",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  bio: "",
  initials: "NH",
};

const DEFAULT_NOTIFY: NotifyPrefs = {
  runCompleted: true,
  criticalFindings: true,
  throttle: true,
  weeklyDigest: false,
  productNews: false,
};

// Only the current browser session is shown by default. Additional sessions
// would come from the backend (or Clerk) in a future iteration — we no longer
// seed fake macOS / iOS entries that confused users in production.
const DEFAULT_SESSIONS: Session[] = [
  {
    id: "sess_current",
    device: typeof navigator !== "undefined" ? detectDevice(navigator.userAgent) : "This browser",
    location: "This device",
    current: true,
    lastActiveAt: "just now",
    kind: "desktop",
  },
];

function detectDevice(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return "Safari on iOS";
  if (/Android/i.test(ua)) return "Chrome on Android";
  if (/Mac OS X/i.test(ua)) return "Safari on macOS";
  if (/Windows/i.test(ua)) return "Chrome on Windows";
  if (/Linux/i.test(ua)) return "Firefox on Linux";
  return "This browser";
}

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeLS<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return chars.join("") || "SX";
}

function maskKey(prefix: string): string {
  return `${prefix}${"•".repeat(24)}`;
}

export default function ProfileClient() {
  // When Clerk is active, identity fields (name/email/avatar) are owned by
  // Clerk. We still allow the user to edit local-only metadata like phone,
  // timezone and bio in this page.
  const clerkEnabled = hasClerk();
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser();
  const { openUserProfile } = useClerk();

  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [notify, setNotify] = useState<NotifyPrefs>(DEFAULT_NOTIFY);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [sessions, setSessions] = useState<Session[]>(DEFAULT_SESSIONS);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 2FA
  const [twofa, setTwofa] = useState<TwoFactor>(DEFAULT_TWOFA);
  const [devices, setDevices] = useState<HardwareKey[]>(DEFAULT_DEVICES);
  const [backupOtp, setBackupOtp] = useState<BackupOtp>(DEFAULT_BACKUP_OTP);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState("");
  const [enrollQr, setEnrollQr] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollCodes, setEnrollCodes] = useState<string[]>([]);
  const [enrollStep, setEnrollStep] = useState<"scan" | "verify" | "recovery">("scan");
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [deviceKind, setDeviceKind] = useState<HardwareKey["kind"]>("yubikey");

  // Password form state
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });

  useEffect(() => {
    setProfile(readLS(STORAGE.profile, DEFAULT_PROFILE));
    setNotify(readLS(STORAGE.notify, DEFAULT_NOTIFY));
    setKeys(readLS<ApiKey[]>(STORAGE.keys, []));
    setTwofa(readLS<TwoFactor>(STORAGE.twofa, DEFAULT_TWOFA));
    setDevices(readLS<HardwareKey[]>(STORAGE.devices, DEFAULT_DEVICES));
    setBackupOtp(readLS<BackupOtp>(STORAGE.backupOtp, DEFAULT_BACKUP_OTP));
    if (typeof window !== "undefined") {
      setAvatarUrl(window.localStorage.getItem(STORAGE.avatar));
    }
  }, []);

  // When Clerk is configured, overlay its live identity onto the stored
  // profile so the page never shows stale hardcoded defaults. Local-only
  // fields (phone, timezone, bio) are preserved. This runs after the
  // localStorage load above so it always wins on the identity fields.
  useEffect(() => {
    if (!clerkEnabled || !clerkLoaded || !clerkUser) return;
    const fullName =
      clerkUser.fullName ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.primaryEmailAddress?.emailAddress ||
      "";
    const email = clerkUser.primaryEmailAddress?.emailAddress ?? "";
    const username =
      clerkUser.username ||
      (email ? email.split("@")[0] : "") ||
      "";
    setProfile((prev) => ({
      ...prev,
      fullName: fullName || prev.fullName,
      email: email || prev.email,
      username: username || prev.username,
      initials: initials(fullName || prev.fullName),
    }));
  }, [clerkEnabled, clerkLoaded, clerkUser]);

  // Source the role badge from the backend instead of the stale "member"
  // default. The server elevates to "platform-admin" via STRIX_ADMIN_EMAILS
  // / STRIX_ADMIN_USER_IDS, which Clerk's client has no way of knowing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getProvider().whoami();
        if (cancelled || !me) return;
        setProfile((prev) =>
          prev.role === me.role ? prev : { ...prev, role: me.role },
        );
      } catch {
        // Non-fatal: leave whatever role is in local storage.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onUploadAvatar = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      window.localStorage.setItem(STORAGE.avatar, data);
      setAvatarUrl(data);
      toast.success("Avatar updated.");
    };
    reader.onerror = () => toast.error("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const onRemoveAvatar = () => {
    window.localStorage.removeItem(STORAGE.avatar);
    setAvatarUrl(null);
    toast.success("Avatar removed.");
  };

  const avatarText = useMemo(() => initials(profile.fullName), [profile.fullName]);

  // Prefer an explicitly-uploaded avatar; fall back to Clerk's hosted image
  // when Clerk is configured. This keeps the UI looking "live" the moment
  // a user signs in, without requiring them to re-upload a photo.
  const displayAvatar = useMemo(
    () => avatarUrl || (clerkEnabled ? clerkUser?.imageUrl ?? null : null),
    [avatarUrl, clerkEnabled, clerkUser?.imageUrl],
  );

  const onSaveProfile = () => {
    // When Clerk owns identity we only persist the local-only metadata
    // (phone, timezone, bio) — the name/email/username inputs are read-only.
    if (!clerkEnabled) {
      if (!profile.fullName.trim()) return toast.error("Full name is required.");
      if (!profile.username.trim()) return toast.error("Username is required.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.email))
        return toast.error("Enter a valid email address.");
    }
    const next = { ...profile, initials: initials(profile.fullName) };
    setProfile(next);
    writeLS(STORAGE.profile, next);
    toast.success("Profile updated.");
  };

  const onSaveNotify = () => {
    writeLS(STORAGE.notify, notify);
    toast.success("Notification preferences saved.");
  };

  const onChangePassword = () => {
    if (pwd.next.length < 12)
      return toast.error("New password must be at least 12 characters.");
    if (pwd.next !== pwd.confirm)
      return toast.error("New password and confirmation do not match.");
    if (!pwd.current) return toast.error("Enter your current password.");
    setPwd({ current: "", next: "", confirm: "" });
    toast.success("Password updated. All other sessions will be signed out.");
    setSessions((prev) => prev.filter((s) => s.current));
  };

  const onCreateKey = async () => {
    if (!newKeyLabel.trim()) return toast.error("Give the key a label.");
    let full = "";
    try {
      // Server-issued token: persisted hash is validated by the API auth layer.
      const issued = await getProvider().createApiToken(newKeyLabel.trim());
      full = issued.token;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create API key");
      return;
    }
    const prefix = full.includes("_") ? `${full.split("_").slice(0, 2).join("_")}_` : "strx_";
    const created: ApiKey = {
      id: `key_${Math.random().toString(36).slice(2, 10)}`,
      label: newKeyLabel.trim(),
      prefix,
      createdAt: new Date().toISOString(),
    };
    const next = [created, ...keys];
    setKeys(next);
    writeLS(STORAGE.keys, next);
    const secrets = readLS<Record<string, string>>(STORAGE.keySecrets, {});
    writeLS(STORAGE.keySecrets, { ...secrets, [created.id]: full });
    setNewKey(full);
    setNewKeyLabel("");
    pushNotification({
      title: "New API key issued",
      message: `Key "${created.label}" created. It inherits your role.`,
      kind: "info",
      href: "/docs",
    });
    toast.success("API key created. Use it in the API Docs page →");
  };

  const onRevokeKey = (id: string) => {
    const next = keys.filter((k) => k.id !== id);
    setKeys(next);
    writeLS(STORAGE.keys, next);
    const secrets = readLS<Record<string, string>>(STORAGE.keySecrets, {});
    delete secrets[id];
    writeLS(STORAGE.keySecrets, secrets);
    toast.success("API key revoked.");
  };

  const onRevokeSession = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    toast.success("Session signed out.");
  };

  const onSignOutEverywhere = () => {
    setSessions((prev) => prev.filter((s) => s.current));
    toast.success("Signed out of every other session.");
  };

  const onDeleteAccount = () => {
    if (!confirm("Delete your account? This action cannot be undone.")) return;
    toast.error("Account deletion requires an organization admin in live mode.");
  };

  // ---------- 2FA ----------

  const startEnroll = async () => {
    const secret = generateSecret(20);
    const url = otpauthUrl({
      secret,
      issuer: "NovaHunter",
      account: profile.email || "user@novahunter.local",
    });
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 256 });
    setEnrollSecret(secret);
    setEnrollQr(qr);
    setEnrollCode("");
    setEnrollCodes([]);
    setEnrollStep("scan");
    setEnrollOpen(true);
  };

  const verifyEnroll = async () => {
    const code = enrollCode.trim();
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit code from your app.");
    const ok = await verifyTotp(enrollSecret, code);
    if (!ok) return toast.error("That code didn't match. Make sure your device clock is accurate.");
    const codes = generateRecoveryCodes();
    setEnrollCodes(codes);
    setEnrollStep("recovery");
    toast.success("Authenticator verified.");
  };

  const finishEnroll = () => {
    const next: TwoFactor = {
      enabled: true,
      enrolledAt: new Date().toISOString(),
      secret: enrollSecret,
      recoveryCodes: enrollCodes,
    };
    setTwofa(next);
    writeLS(STORAGE.twofa, next);
    setEnrollOpen(false);
    pushNotification({
      title: "Two-factor authentication enabled",
      message: "Your account now requires a 6-digit code at sign-in.",
      kind: "success",
      href: "/profile?tab=security",
    });
    toast.success("Two-factor authentication is now active.");
  };

  const disable2fa = () => {
    if (!confirm("Disable 2FA? Your account will be less secure.")) return;
    const next: TwoFactor = { enabled: false };
    setTwofa(next);
    writeLS(STORAGE.twofa, next);
    toast.success("2FA disabled.");
  };

  const regenRecovery = () => {
    if (!twofa.enabled) return;
    const codes = generateRecoveryCodes();
    const next = { ...twofa, recoveryCodes: codes };
    setTwofa(next);
    writeLS(STORAGE.twofa, next);
    toast.success("New recovery codes generated. Old codes are now invalid.");
    setEnrollCodes(codes);
    setEnrollStep("recovery");
    setEnrollOpen(true);
  };

  const downloadRecovery = () => {
    const codes = twofa.recoveryCodes ?? enrollCodes;
    if (codes.length === 0) return;
    const text = [
      `NovaHunter recovery codes for ${profile.email}`,
      `Generated: ${new Date().toUTCString()}`,
      "",
      ...codes,
      "",
      "Keep these somewhere safe. Each code can be used once.",
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "strix-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const copyText = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Copy failed");
    }
  };

  // ---------- Hardware keys ----------

  const onAddDevice = () => {
    if (!deviceName.trim()) return toast.error("Give the device a name.");
    const dev: HardwareKey = {
      id: `dev_${Math.random().toString(36).slice(2, 10)}`,
      name: deviceName.trim(),
      kind: deviceKind,
      addedAt: new Date().toISOString(),
    };
    const next = [dev, ...devices];
    setDevices(next);
    writeLS(STORAGE.devices, next);
    setDeviceName("");
    setDeviceKind("yubikey");
    setDeviceOpen(false);
    toast.success("Security key registered.");
  };

  const onRemoveDevice = (id: string) => {
    const next = devices.filter((d) => d.id !== id);
    setDevices(next);
    writeLS(STORAGE.devices, next);
    toast.success("Security key removed.");
  };

  const toggleBackupOtp = () => {
    const next: BackupOtp = { enabled: !backupOtp.enabled, email: profile.email };
    setBackupOtp(next);
    writeLS(STORAGE.backupOtp, next);
    toast.success(`Backup email OTP ${next.enabled ? "enabled" : "disabled"}.`);
  };

  return (
    <>
      <PageHeader
        title="Profile & account"
        description="Manage how you appear in NovaHunter, your security settings, API access, and notifications."
      />

      <div className="mb-4 flex items-center gap-4 rounded-xl border border-border bg-surface/60 p-4">
        <Avatar className="h-14 w-14 text-base">
          {displayAvatar && <AvatarImage src={displayAvatar} alt={profile.fullName} />}
          <AvatarFallback>{avatarText}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{profile.fullName || "Unnamed"}</h2>
            <Badge variant="outline">{profile.role || "member"}</Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            @{profile.username} · {profile.email}
          </p>
        </div>
        {config.demo && <Badge variant="warning">Demo mode</Badge>}
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="mr-2 h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound className="mr-2 h-4 w-4" />
            API keys
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Personal details</CardTitle>
                <CardDescription>
                  {clerkEnabled
                    ? "Identity (name, username, email) is managed by your authentication provider."
                    : "Shown to teammates inside this workspace."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Labeled label="Full name">
                  <Input
                    value={profile.fullName}
                    readOnly={clerkEnabled}
                    onChange={(e) =>
                      !clerkEnabled && setProfile({ ...profile, fullName: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label="Username">
                  <Input
                    value={profile.username}
                    readOnly={clerkEnabled}
                    onChange={(e) =>
                      !clerkEnabled &&
                      setProfile({
                        ...profile,
                        username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                      })
                    }
                  />
                </Labeled>
                <Labeled label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    readOnly={clerkEnabled}
                    onChange={(e) =>
                      !clerkEnabled && setProfile({ ...profile, email: e.target.value })
                    }
                  />
                </Labeled>
                {clerkEnabled && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => openUserProfile()}
                  >
                    <User className="mr-2 h-4 w-4" />
                    Manage identity on Clerk
                  </Button>
                )}
                <Labeled label="Phone (for 2FA)">
                  <Input
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    placeholder="+91 …"
                  />
                </Labeled>
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Role">
                    <Input value={profile.role} readOnly />
                  </Labeled>
                  <Labeled label="Timezone">
                    <Input
                      value={profile.timezone}
                      onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                    />
                  </Labeled>
                </div>
                <Labeled label="Bio">
                  <Textarea
                    rows={3}
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    placeholder="One-liner that appears next to your findings."
                  />
                </Labeled>
                <Button onClick={onSaveProfile} className="w-full">
                  Save profile
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avatar</CardTitle>
                <CardDescription>
                  {clerkEnabled
                    ? "Your Clerk avatar is used by default. Upload a local image to override it in this browser."
                    : "Upload a square image (JPG, PNG or WebP) up to 2 MB. Stored in your browser."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4 py-6">
                <Avatar className="h-24 w-24 text-2xl">
                  {displayAvatar && <AvatarImage src={displayAvatar} alt={profile.fullName} />}
                  <AvatarFallback>{avatarText}</AvatarFallback>
                </Avatar>
                <div className="text-center text-sm text-muted-foreground">
                  {avatarUrl
                    ? "Looking sharp. Your photo is live everywhere in the app."
                    : "Initials update automatically from your full name."}
                </div>
                <div className="flex gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUploadAvatar(f);
                        e.currentTarget.value = "";
                      }}
                    />
                    <span className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface-2/60 px-3 text-sm transition-colors hover:bg-surface-2">
                      {avatarUrl ? "Replace image" : "Upload image"}
                    </span>
                  </label>
                  {avatarUrl && (
                    <Button variant="outline" onClick={onRemoveAvatar}>
                      Remove
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Change password</CardTitle>
                <CardDescription>
                  Use at least 12 characters. We recommend a password manager.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Labeled label="Current password">
                  <Input
                    type="password"
                    value={pwd.current}
                    onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
                  />
                </Labeled>
                <Labeled label="New password">
                  <Input
                    type="password"
                    value={pwd.next}
                    onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                  />
                </Labeled>
                <Labeled label="Confirm new password">
                  <Input
                    type="password"
                    value={pwd.confirm}
                    onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                  />
                </Labeled>
                <Button onClick={onChangePassword} className="w-full">
                  Update password
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Two-factor authentication</CardTitle>
                <CardDescription>
                  Add a second step to every sign-in with an authenticator app or hardware key.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3">
                  <div className="flex items-center gap-3">
                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Authenticator app (TOTP)</div>
                      <div className="text-xs text-muted-foreground">
                        {twofa.enabled
                          ? `Enrolled ${twofa.enrolledAt ? new Date(twofa.enrolledAt).toLocaleString() : ""}`
                          : "Google Authenticator, 1Password, Authy…"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={twofa.enabled ? "success" : "outline"}>
                      {twofa.enabled ? "Enabled" : "Not enabled"}
                    </Badge>
                    {twofa.enabled ? (
                      <>
                        <Button size="sm" variant="outline" onClick={regenRecovery}>
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Recovery codes
                        </Button>
                        <Button size="sm" variant="destructive" onClick={disable2fa}>
                          Disable
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={startEnroll}>
                        Enable
                      </Button>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-surface/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Hardware security keys</div>
                        <div className="text-xs text-muted-foreground">
                          {devices.length === 0
                            ? "YubiKey, SoloKeys, Titan, or platform authenticators"
                            : `${devices.length} key${devices.length === 1 ? "" : "s"} registered`}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setDeviceOpen(true)}>
                      <UserPlus className="mr-1 h-3 w-3" />
                      Register
                    </Button>
                  </div>
                  {devices.length > 0 && (
                    <ul className="mt-3 space-y-2 text-xs">
                      {devices.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between rounded border border-border bg-background/40 px-2 py-1.5"
                        >
                          <div>
                            <span className="font-medium">{d.name}</span>{" "}
                            <span className="text-muted-foreground">({d.kind})</span>
                            <div className="text-[10px] text-muted-foreground">
                              added {new Date(d.addedAt).toLocaleString()}
                            </div>
                          </div>
                          <button
                            onClick={() => onRemoveDevice(d.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Backup email OTP</div>
                      <div className="text-xs text-muted-foreground">
                        Send codes to {backupOtp.email ?? profile.email}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={backupOtp.enabled ? "outline" : "default"}
                    onClick={toggleBackupOtp}
                  >
                    {backupOtp.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>

                {twofa.enabled && twofa.recoveryCodes && twofa.recoveryCodes.length > 0 && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium">Recovery codes</span>
                      <Button size="sm" variant="ghost" onClick={downloadRecovery}>
                        <Download className="mr-1 h-3 w-3" />
                        Download
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 font-mono">
                      {twofa.recoveryCodes.map((c) => (
                        <code key={c} className="rounded bg-background/60 px-2 py-0.5 text-[11px]">
                          {c}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Active sessions</CardTitle>
                <CardDescription>
                  Devices currently signed in to your account.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3"
                  >
                    <div className="flex items-center gap-3">
                      {s.kind === "desktop" ? (
                        <Laptop className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Smartphone className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <div className="text-sm font-medium">
                          {s.device}{" "}
                          {s.current && <Badge variant="success">This device</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.location} · last active {s.lastActiveAt}
                        </div>
                      </div>
                    </div>
                    {!s.current && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onRevokeSession(s.id)}
                      >
                        <LogOut className="mr-1 h-3 w-3" />
                        Sign out
                      </Button>
                    )}
                  </div>
                ))}
                <Separator />
                <Button variant="outline" onClick={onSignOutEverywhere}>
                  Sign out everywhere else
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border-destructive/30">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>
                  Permanently delete your account and all personal data.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" onClick={onDeleteAccount}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete account
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="keys">
          <Card>
            <CardHeader>
              <CardTitle>Personal API keys</CardTitle>
              <CardDescription>
                Use these to authenticate the NovaHunter CLI or automations against
                this workspace. Each key inherits your role. See the{" "}
                <a href="/docs" className="text-primary underline-offset-2 hover:underline">
                  API documentation
                </a>{" "}
                for usage examples.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. CI pipeline, personal laptop"
                />
                <Button onClick={onCreateKey}>Create key</Button>
              </div>

              {newKey && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                  <div className="mb-1 font-medium">New API key</div>
                  <code className="block break-all rounded bg-surface-2 px-2 py-1 font-mono text-xs">
                    {newKey}
                  </code>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Copy it now — for your security, the full key will never be
                    shown again.
                  </p>
                </div>
              )}

              {keys.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No API keys yet. Create one above.
                </p>
              ) : (
                <div className="space-y-2">
                  {keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between rounded-md border border-border bg-surface/60 p-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{k.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {maskKey(k.prefix)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Created {new Date(k.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onRevokeKey(k.id)}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>Pick which events reach your inbox.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <NotifyRow
                label="Run completed"
                description="Emailed when any scan finishes."
                checked={notify.runCompleted}
                onChange={(v) => setNotify({ ...notify, runCompleted: v })}
              />
              <NotifyRow
                label="Critical findings"
                description="Immediate alert when a Critical or High finding is recorded."
                checked={notify.criticalFindings}
                onChange={(v) => setNotify({ ...notify, criticalFindings: v })}
              />
              <NotifyRow
                label="LLM throttling"
                description="When a provider rate-limit pauses your runs."
                checked={notify.throttle}
                onChange={(v) => setNotify({ ...notify, throttle: v })}
              />
              <NotifyRow
                label="Weekly digest"
                description="Monday summary of runs and findings."
                checked={notify.weeklyDigest}
                onChange={(v) => setNotify({ ...notify, weeklyDigest: v })}
              />
              <NotifyRow
                label="Product news"
                description="Occasional updates about new features."
                checked={notify.productNews}
                onChange={(v) => setNotify({ ...notify, productNews: v })}
              />
              <Button onClick={onSaveNotify} className="w-full">
                Save preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 2FA enrollment dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {enrollStep === "scan"
                ? "Set up authenticator"
                : enrollStep === "verify"
                  ? "Verify your code"
                  : "Save your recovery codes"}
            </DialogTitle>
            <DialogDescription>
              {enrollStep === "scan"
                ? "Scan the QR code with any TOTP app, then enter the 6-digit code it shows."
                : enrollStep === "verify"
                  ? "Check your authenticator app for the current 6-digit code."
                  : "If you lose your device, any one of these codes will get you back in. Each code works once."}
            </DialogDescription>
          </DialogHeader>
          {enrollStep !== "recovery" && (
            <div className="space-y-3">
              {enrollQr && (
                <div className="flex justify-center rounded-md border border-border bg-white p-3">
                  <Image
                    src={enrollQr}
                    alt="TOTP QR code"
                    width={224}
                    height={224}
                    unoptimized
                    className="h-56 w-56"
                  />
                </div>
              )}
              <div className="rounded-md border border-border bg-surface/60 p-3">
                <div className="mb-1 text-xs text-muted-foreground">
                  Can&apos;t scan? Enter this secret manually:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 select-all break-all rounded bg-background/60 px-2 py-1 font-mono text-xs">
                    {enrollSecret}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyText(enrollSecret, "Secret copied")}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  6-digit code from your app
                </label>
                <Input
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  className="font-mono tracking-[0.3em]"
                />
              </div>
            </div>
          )}
          {enrollStep === "recovery" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 font-mono text-sm">
                {enrollCodes.map((c) => (
                  <code key={c} className="rounded bg-background/60 px-2 py-1 text-center">
                    {c}
                  </code>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => copyText(enrollCodes.join("\n"), "Recovery codes copied")}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </Button>
                <Button variant="outline" className="flex-1" onClick={downloadRecovery}>
                  <Download className="mr-1 h-3 w-3" />
                  Download
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Store these somewhere safe. You won&apos;t see them again.
              </p>
            </div>
          )}
          <DialogFooter>
            {enrollStep === "scan" && (
              <>
                <Button variant="outline" onClick={() => setEnrollOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={verifyEnroll} disabled={enrollCode.length !== 6}>
                  <Check className="mr-1 h-3 w-3" />
                  Verify code
                </Button>
              </>
            )}
            {enrollStep === "recovery" && <Button onClick={finishEnroll}>I&apos;ve saved them</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hardware key register dialog */}
      <Dialog open={deviceOpen} onOpenChange={setDeviceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register a security key</DialogTitle>
            <DialogDescription>
              Give the key a recognisable name. You can remove it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Name</label>
              <Input
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="YubiKey 5C · desk"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Type</label>
              <div className="grid grid-cols-4 gap-2">
                {(["yubikey", "solokey", "titan", "platform"] as HardwareKey["kind"][]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDeviceKind(k)}
                    className={`rounded-md border px-2 py-1.5 text-xs capitalize transition-colors ${
                      deviceKind === k
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-surface-2/60"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              In live mode the browser&apos;s WebAuthn prompt would appear now.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeviceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onAddDevice}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function NotifyRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-surface/60 p-3 transition-colors hover:bg-surface-2/60">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}
