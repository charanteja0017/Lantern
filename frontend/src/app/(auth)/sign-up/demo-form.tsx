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

// Static fallback sign-up card for demo mode (Clerk not configured).
export function DemoSignUpForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your workspace</CardTitle>
        <CardDescription>
          Demo mode is active — fill anything and continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">First name</label>
            <Input placeholder="Jane" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Last name</label>
            <Input placeholder="Doe" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Work email</label>
          <Input type="email" placeholder="you@company.com" />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Organization</label>
          <Input placeholder="Acme Security" />
        </div>
        <Link href="/dashboard" className="block">
          <Button className="w-full">Create workspace</Button>
        </Link>
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
