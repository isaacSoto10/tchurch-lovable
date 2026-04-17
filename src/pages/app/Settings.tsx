import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useAuth } from "@clerk/clerk-react";
import { User, Bell, Church, LogOut, Settings, Loader2, Check, X, Shield } from "lucide-react";

type PendingMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  imageUrl?: string;
  createdAt: string;
};

export default function Settings() {
  const { user } = useAuth();
  const { selectedChurch, churches, switchChurch } = useChurch();
  const { fetchApi } = useApi();
  const isAdmin = selectedChurch?.role === "ADMIN";

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefs, setPrefs] = useState({
    emailAssignments: true,
    emailAnnouncements: true,
    weeklyDigest: false,
  });

  const [churchInfo, setChurchInfo] = useState<any>(null);
  const [savingChurch, setSavingChurch] = useState(false);
  const [churchForm, setChurchForm] = useState({ name: "", brandColor: "" });

  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchApi<any>("/users/me");
        setProfile(data);
      } catch (e) {
        console.error("Failed to load profile:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fetchApi]);

  useEffect(() => {
    if (selectedChurch?.id) {
      setChurchForm({ name: selectedChurch.name || "", brandColor: selectedChurch.brandColor || "#000000" });
    }
  }, [selectedChurch]);

  useEffect(() => {
    if (isAdmin && selectedChurch?.id) {
      loadPendingMembers();
    }
  }, [isAdmin, selectedChurch?.id]);

  async function loadPendingMembers() {
    setLoadingPending(true);
    try {
      const data = await fetchApi<{ users: PendingMember[] }>(`/churches/${selectedChurch.id}/pending-users`);
      setPendingMembers(data.users || []);
    } catch (e) {
      console.error("Failed to load pending members:", e);
    } finally {
      setLoadingPending(false);
    }
  }

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

  async function handleApprove(userId: string) {
    setProcessingId(userId);
    try {
      await fetchApi(`/churches/${selectedChurch.id}/users/${userId}/approve`, {
        method: "POST",
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
      await fetchApi(`/churches/${selectedChurch.id}/users/${userId}/deny`, {
        method: "POST",
      });
      setPendingMembers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      console.error("Failed to deny user:", e);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSaveChurch() {
    if (!churchInfo && !isAdmin) return;
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
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile and preferences</p>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="church">Church</TabsTrigger>
              <TabsTrigger value="members">
                Members
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile
              </CardTitle>
              <CardDescription>Your personal information</CardDescription>
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

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Church className="w-5 h-5" />
                Church
              </CardTitle>
              <CardDescription>Your church membership</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium">{selectedChurch?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    Role: {selectedChurch?.role?.toLowerCase()}
                  </p>
                </div>
              </div>
              {churches.length > 1 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Switch to another church:</p>
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

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                App
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">Version</p>
                <p className="text-sm text-muted-foreground">1.0.0</p>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">Sign out</p>
                <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600">
                  <LogOut className="w-4 h-4 mr-1" />
                  Sign Out
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Notifications
              </CardTitle>
              <CardDescription>Choose how you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="font-medium text-sm">Service Assignments</p>
                  <p className="text-xs text-muted-foreground">Email when assigned to a service</p>
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
                  <p className="font-medium text-sm">Announcements</p>
                  <p className="text-xs text-muted-foreground">Email for new announcements</p>
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
                  <p className="font-medium text-sm">Weekly Digest</p>
                  <p className="text-xs text-muted-foreground">Summary of week's activities</p>
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

        {isAdmin && (
          <>
            <TabsContent value="church" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Church className="w-5 h-5" />
                    Church Information
                  </CardTitle>
                  <CardDescription>Update your church details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">Church Name</label>
                    <input
                      type="text"
                      value={churchForm.name}
                      onChange={(e) => setChurchForm({ ...churchForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Brand Color</label>
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
                    Save Changes
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Pending Member Requests
                  </CardTitle>
                  <CardDescription>
                    Review and approve or deny membership requests
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPending ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : pendingMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No pending requests
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
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDeny(member.id)}
                              disabled={processingId === member.id}
                            >
                              <X className="w-4 h-4 mr-1" />
                              Deny
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
