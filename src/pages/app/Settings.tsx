import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { User, Bell, Church, LogOut, Settings as SettingsIcon, Loader2, Check, X, Shield, MessageCircle } from "lucide-react";

type PendingMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  imageUrl?: string;
  createdAt: string;
};

type Profile = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  imageUrl?: string | null;
};

type ChurchMemberRecord = {
  userId: string;
  status?: string | null;
  createdAt?: string | null;
  joinedAt?: string | null;
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    imageUrl?: string | null;
  } | null;
};

type WhatsAppSettings = {
  user: {
    whatsappPhone: string;
    whatsappOptIn: boolean;
    whatsappNotifications: boolean;
    whatsappLanguage: "es" | "en";
  };
  preferences: {
    whatsappAssignments: boolean;
    whatsappAnnouncements: boolean;
    whatsappEvents: boolean;
    whatsappResources: boolean;
  };
  church: {
    whatsappGroupUrl: string;
    whatsappEnabled: boolean;
  };
  role: string;
  config: {
    configured: boolean;
    templates: Record<string, boolean>;
  };
};

export default function Settings() {
  const { selectedChurch, churches, switchChurch } = useChurch();
  const { fetchApi } = useApi();
  const isAdmin = selectedChurch?.role === "ADMIN";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefs, setPrefs] = useState({
    emailAssignments: true,
    emailAnnouncements: true,
    weeklyDigest: false,
  });

  const [savingChurch, setSavingChurch] = useState(false);
  const [churchForm, setChurchForm] = useState({ name: "", brandColor: "" });

  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [whatsappSettings, setWhatsappSettings] = useState<WhatsAppSettings | null>(null);
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(false);
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [whatsappError, setWhatsappError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchApi<Profile>("/users/me");
        setProfile(data);
      } catch (e) {
        console.error("Failed to load profile:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchApi]);

  const loadWhatsAppSettings = useCallback(async () => {
    setLoadingWhatsApp(true);
    try {
      const data = await fetchApi<WhatsAppSettings>("/whatsapp/settings");
      setWhatsappSettings(data);
    } catch (e) {
      console.error("Failed to load WhatsApp settings:", e);
    } finally {
      setLoadingWhatsApp(false);
    }
  }, [fetchApi]);

  useEffect(() => {
    loadWhatsAppSettings();
  }, [loadWhatsAppSettings]);

  useEffect(() => {
    if (selectedChurch?.id) {
      setChurchForm({ name: selectedChurch.name || "", brandColor: selectedChurch.brandColor || "#000000" });
    }
  }, [selectedChurch]);

  const loadPendingMembers = useCallback(async () => {
    if (!selectedChurch?.id) return;
    setLoadingPending(true);
    try {
      const data = await fetchApi<{ members?: ChurchMemberRecord[] }>(`/churches/${selectedChurch.id}/members`);
      const pending = (data.members || [])
        .filter((member) => member.status === "PENDING" || !member.status)
        .map((member) => ({
          id: member.userId,
          firstName: member.user?.firstName || "",
          lastName: member.user?.lastName || "",
          email: member.user?.email || "",
          imageUrl: member.user?.imageUrl || "",
          createdAt: member.createdAt || member.joinedAt || "",
        }));
      setPendingMembers(pending);
    } catch (e) {
      console.error("Failed to load pending members:", e);
    } finally {
      setLoadingPending(false);
    }
  }, [fetchApi, selectedChurch?.id]);

  useEffect(() => {
    if (isAdmin && selectedChurch?.id) {
      loadPendingMembers();
    }
  }, [isAdmin, loadPendingMembers, selectedChurch?.id]);

  async function handleToggle(key: keyof typeof prefs, value: boolean) {
    setSavingPrefs(true);
    try {
      const updated = { ...prefs, [key]: value };
      await fetchApi(`/users/${profile?.id}/notification-preferences`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
      setPrefs(updated);
    } catch (e) {
      console.error("Failed to save preference:", e);
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleSaveWhatsApp() {
    if (!whatsappSettings) return;
    setSavingWhatsApp(true);
    setWhatsappMessage("");
    setWhatsappError("");
    try {
      const data = await fetchApi<WhatsAppSettings>("/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({
          whatsappPhone: whatsappSettings.user.whatsappPhone,
          whatsappOptIn: whatsappSettings.user.whatsappOptIn,
          whatsappNotifications: whatsappSettings.user.whatsappNotifications,
          whatsappLanguage: whatsappSettings.user.whatsappLanguage,
          preferences: whatsappSettings.preferences,
          ...(isAdmin ? {
            churchWhatsappGroupUrl: whatsappSettings.church.whatsappGroupUrl,
            whatsappEnabled: whatsappSettings.church.whatsappEnabled,
          } : {}),
        }),
      });
      setWhatsappSettings(data);
      setWhatsappMessage("WhatsApp settings saved.");
    } catch (e) {
      setWhatsappError("Could not save WhatsApp settings.");
    } finally {
      setSavingWhatsApp(false);
    }
  }

  async function handleTestWhatsApp() {
    setTestingWhatsApp(true);
    setWhatsappMessage("");
    setWhatsappError("");
    try {
      const data = await fetchApi<{ ok?: boolean; disabled?: boolean; error?: string }>("/whatsapp/settings", {
        method: "POST",
      });
      if (data.ok === false && !data.disabled) throw new Error(data.error || "Could not send test.");
      setWhatsappMessage(data.disabled ? "Preferences saved. WhatsApp Cloud API is not configured yet." : "Test WhatsApp sent.");
    } catch (e) {
      setWhatsappError(e instanceof Error ? e.message : "Could not send test WhatsApp.");
    } finally {
      setTestingWhatsApp(false);
    }
  }

  function updateWhatsAppUser<K extends keyof WhatsAppSettings["user"]>(key: K, value: WhatsAppSettings["user"][K]) {
    setWhatsappSettings((current) => current ? { ...current, user: { ...current.user, [key]: value } } : current);
  }

  function updateWhatsAppChurch<K extends keyof WhatsAppSettings["church"]>(key: K, value: WhatsAppSettings["church"][K]) {
    setWhatsappSettings((current) => current ? { ...current, church: { ...current.church, [key]: value } } : current);
  }

  function updateWhatsAppPreference<K extends keyof WhatsAppSettings["preferences"]>(key: K, value: WhatsAppSettings["preferences"][K]) {
    setWhatsappSettings((current) => current ? { ...current, preferences: { ...current.preferences, [key]: value } } : current);
  }

  async function handleApprove(userId: string) {
    setProcessingId(userId);
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      });
      setPendingMembers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      console.error("Failed to approve user:", e);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleDeny(userId: string) {
    setProcessingId(userId);
    try {
      await fetchApi(`/churches/${selectedChurch.id}/members/${userId}/approve`, {
        method: "PATCH",
        body: JSON.stringify({ action: "deny" }),
      });
      setPendingMembers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      console.error("Failed to deny user:", e);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSaveChurch() {
    if (!selectedChurch?.id || !isAdmin) return;
    setSavingChurch(true);
    try {
      await fetchApi(`/churches/${selectedChurch.id}`, {
        method: "PUT",
        body: JSON.stringify(churchForm),
      });
    } catch (e) {
      console.error("Failed to save church info:", e);
    } finally {
      setSavingChurch(false);
    }
  }

  function handleSwitchChurch() {
    if (churches.length <= 1) return;
    const others = churches.filter((c) => c.id !== selectedChurch?.id);
    if (others.length > 0) {
      switchChurch(others[0]);
    }
  }

  const initials = `${profile?.firstName?.[0] || ""}${profile?.lastName?.[0] || ""}`.toUpperCase() || "?";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mobile-page mx-auto max-w-2xl space-y-5">
      <div className="app-card-soft p-4">
        <p className="mobile-section-title">Preferencias</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-zinc-950">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">Administra tu perfil, notificaciones y acceso de la iglesia.</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="profile" className="shrink-0 rounded-xl">Perfil</TabsTrigger>
          <TabsTrigger value="notifications" className="shrink-0 rounded-xl">Notificaciones</TabsTrigger>
          <TabsTrigger value="whatsapp" className="shrink-0 rounded-xl">
            <MessageCircle className="w-4 h-4 mr-1.5" />
            WhatsApp
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="church" className="shrink-0 rounded-xl">Iglesia</TabsTrigger>
              <TabsTrigger value="members" className="shrink-0 rounded-xl">
                Miembros
                {pendingMembers.length > 0 && (
                  <Badge variant="destructive" className="ml-1.5 h-5 w-5 p-0 text-xs justify-center items-center">
                    {pendingMembers.length}
                  </Badge>
                )}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <Card className="app-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Perfil
              </CardTitle>
              <CardDescription>Tu información personal</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={profile?.imageUrl} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-lg">
                    {profile?.firstName} {profile?.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{profile?.email}</p>
                  {selectedChurch && (
                    <Badge variant="secondary" className="mt-1 capitalize">
                      {selectedChurch.role?.toLowerCase()} in {selectedChurch.name}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="app-card mt-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Church className="w-5 h-5" />
                Iglesia
              </CardTitle>
              <CardDescription>Tu membresía de iglesia</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium">{selectedChurch?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    Rol: {selectedChurch?.role?.toLowerCase()}
                  </p>
                </div>
              </div>
              {churches.length > 1 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Cambiar a otra iglesia:</p>
                    <div className="flex flex-wrap gap-2">
                      {churches
                        .filter((c) => c.id !== selectedChurch?.id)
                        .map((church) => (
                          <Button
                            key={church.id}
                            variant="outline"
                            size="sm"
                            onClick={() => switchChurch(church)}
                          >
                            {church.name}
                          </Button>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="app-card mt-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" />
                App
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">Versión</p>
                <p className="text-sm text-muted-foreground">1.0.0</p>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">Cerrar sesión</p>
                <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600">
                  <LogOut className="w-4 h-4 mr-1" />
                  Salir
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card className="app-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notificaciones
              </CardTitle>
              <CardDescription>Elige cómo quieres recibir avisos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="font-medium text-sm">Asignaciones de servicio</p>
                  <p className="text-xs text-muted-foreground">Email cuando te asignen a un servicio</p>
                </div>
                <Switch
                  checked={prefs.emailAssignments}
                  onCheckedChange={(v) => handleToggle("emailAssignments", v)}
                  disabled={savingPrefs}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="font-medium text-sm">Anuncios</p>
                  <p className="text-xs text-muted-foreground">Email por nuevos anuncios</p>
                </div>
                <Switch
                  checked={prefs.emailAnnouncements}
                  onCheckedChange={(v) => handleToggle("emailAnnouncements", v)}
                  disabled={savingPrefs}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="font-medium text-sm">Resumen semanal</p>
                  <p className="text-xs text-muted-foreground">Resumen de las actividades de la semana</p>
                </div>
                <Switch
                  checked={prefs.weeklyDigest}
                  onCheckedChange={(v) => handleToggle("weeklyDigest", v)}
                  disabled={savingPrefs}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-6">
          <Card className="app-card border-emerald-100 bg-gradient-to-br from-white to-emerald-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-emerald-600" />
                WhatsApp
              </CardTitle>
              <CardDescription>
                Recibe anuncios, eventos, asignaciones y recursos donde tu iglesia ya se comunica.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingWhatsApp || !whatsappSettings ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {!whatsappSettings.config.configured && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      WhatsApp Cloud API is not configured yet, but users can still save opt-in preferences and group links.
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium block mb-1">Número de WhatsApp</label>
                    <input
                      value={whatsappSettings.user.whatsappPhone}
                      onChange={(event) => updateWhatsAppUser("whatsappPhone", event.target.value)}
                      placeholder="+1 555 123 4567"
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-1">Idioma de mensajes</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={whatsappSettings.user.whatsappLanguage === "es" ? "default" : "outline"}
                        onClick={() => updateWhatsAppUser("whatsappLanguage", "es")}
                      >
                        Español
                      </Button>
                      <Button
                        type="button"
                        variant={whatsappSettings.user.whatsappLanguage === "en" ? "default" : "outline"}
                        onClick={() => updateWhatsAppUser("whatsappLanguage", "en")}
                      >
                        English
                      </Button>
                    </div>
                  </div>

                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <p className="font-medium text-sm">Acepto recibir mensajes por WhatsApp</p>
                      <p className="text-xs text-muted-foreground">Requerido antes de enviar notificaciones.</p>
                    </div>
                    <Switch
                      checked={whatsappSettings.user.whatsappOptIn}
                      onCheckedChange={(value) => updateWhatsAppUser("whatsappOptIn", value)}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <p className="font-medium text-sm">Enviar notificaciones por WhatsApp</p>
                      <p className="text-xs text-muted-foreground">Asignaciones, eventos, anuncios y recursos.</p>
                    </div>
                    <Switch
                      checked={whatsappSettings.user.whatsappNotifications}
                      onCheckedChange={(value) => updateWhatsAppUser("whatsappNotifications", value)}
                    />
                  </div>

                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 space-y-3">
                    <div>
                      <p className="font-medium text-sm">¿Qué debe llegar por WhatsApp?</p>
                      <p className="text-xs text-muted-foreground">Mantén el canal útil y sin ruido.</p>
                    </div>
                    {[
                      ["whatsappAssignments", "Asignaciones de servicio"],
                      ["whatsappAnnouncements", "Anuncios"],
                      ["whatsappEvents", "Eventos y recordatorios"],
                      ["whatsappResources", "Recursos de ministerio"],
                    ].map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                        <p className="text-sm">{label}</p>
                        <Switch
                          checked={whatsappSettings.preferences[key as keyof WhatsAppSettings["preferences"]]}
                          onCheckedChange={(value) => updateWhatsAppPreference(key as keyof WhatsAppSettings["preferences"], value)}
                          disabled={!whatsappSettings.user.whatsappNotifications}
                        />
                      </div>
                    ))}
                  </div>

                  {isAdmin && (
                    <>
                      <Separator />
                      <div>
                        <label className="text-sm font-medium block mb-1">Link del grupo de WhatsApp</label>
                        <input
                          value={whatsappSettings.church.whatsappGroupUrl}
                          onChange={(event) => updateWhatsAppChurch("whatsappGroupUrl", event.target.value)}
                          placeholder="https://chat.whatsapp.com/..."
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 pr-4">
                          <p className="font-medium text-sm">Mostrar herramientas del grupo</p>
                          <p className="text-xs text-muted-foreground">Muestra links y acciones rápidas para miembros.</p>
                        </div>
                        <Switch
                          checked={whatsappSettings.church.whatsappEnabled}
                          onCheckedChange={(value) => updateWhatsAppChurch("whatsappEnabled", value)}
                        />
                      </div>
                    </>
                  )}

                  {whatsappMessage && (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{whatsappMessage}</p>
                  )}
                  {whatsappError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{whatsappError}</p>
                  )}

                  <div className="flex gap-2">
                    <Button onClick={handleSaveWhatsApp} disabled={savingWhatsApp} className="flex-1">
                      {savingWhatsApp && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Guardar
                    </Button>
                    <Button onClick={handleTestWhatsApp} disabled={testingWhatsApp} variant="outline" className="flex-1">
                      {testingWhatsApp && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Probar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="church" className="mt-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Church className="w-5 h-5" />
                    Información de la iglesia
                  </CardTitle>
                  <CardDescription>Actualiza los datos de tu iglesia</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Nombre de la iglesia</label>
                    <input
                      type="text"
                      value={churchForm.name}
                      onChange={(e) => setChurchForm({ ...churchForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Color de marca</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={churchForm.brandColor || "#000000"}
                        onChange={(e) => setChurchForm({ ...churchForm, brandColor: e.target.value })}
                        className="w-10 h-10 border rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={churchForm.brandColor || ""}
                        onChange={(e) => setChurchForm({ ...churchForm, brandColor: e.target.value })}
                        className="flex-1 px-3 py-2 border rounded-md text-sm"
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                  <Button onClick={handleSaveChurch} disabled={savingChurch} className="mt-2">
                    {savingChurch && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Guardar cambios
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members" className="mt-6">
              <Card className="app-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Solicitudes pendientes
                  </CardTitle>
                  <CardDescription>
                    Revisa y aprueba o rechaza solicitudes de membresía
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPending ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : pendingMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No hay solicitudes pendientes
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {pendingMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={member.imageUrl} />
                              <AvatarFallback>
                                {`${member.firstName?.[0] || ""}${member.lastName?.[0] || ""}`.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">
                                {member.firstName} {member.lastName}
                              </p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={() => handleApprove(member.id)}
                              disabled={processingId === member.id}
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDeny(member.id)}
                              disabled={processingId === member.id}
                            >
                              <X className="w-4 h-4 mr-1" />
                              Rechazar
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

          </>
        )}
      </Tabs>
    </div>
  );
}
