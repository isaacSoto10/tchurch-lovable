import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useApi } from "@/hooks/useApi";
import { useChurch } from "@/providers/ChurchProvider";
import { useAuth } from "@clerk/clerk-react";
import { User, Bell, Church, LogOut, Settings, Loader2 } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const { selectedChurch, churches, switchChurch } = useChurch();
  const { fetchApi } = useApi();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefs, setPrefs] = useState({
    emailAssignments: true,
    emailAnnouncements: true,
    weeklyDigest: false,
  });

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

  function handleSwitchChurch() {
    if (churches.length <= 1) return;
    const current = churches.find((c) => c.id === selectedChurch?.id);
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

      <div className="space-y-6">
        {/* Profile Section */}
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

        {/* Notification Preferences */}
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

        {/* Church Section */}
        <Card>
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

        {/* App Section */}
        <Card>
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
      </div>
    </div>
  );
}
