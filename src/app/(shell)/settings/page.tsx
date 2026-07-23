import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Niche profile, API keys, and sync preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Phase 2/3 builds this — see docs/PLAN.md
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Niche profile, API keys, and sync interval settings land here.
        </CardContent>
      </Card>
    </div>
  );
}
