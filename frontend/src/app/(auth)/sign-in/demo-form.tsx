import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Static fallback sign-in card shown when Clerk is not configured.
// Only mounted in demo mode, so the link-only "Continue" is intentional.
export function DemoSignInForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Demo mode is active — any values will enter the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <Input type="email" placeholder="you@company.com" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Password</label>
          <Input type="password" placeholder="••••••••" />
        </div>
        <Link href="/dashboard" className="block">
          <Button className="w-full">Continue</Button>
        </Link>
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
