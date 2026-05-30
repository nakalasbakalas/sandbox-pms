import { useOnboarding } from '@/hooks/use-onboarding'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Info } from '@phosphor-icons/react'
import type { UserSetup } from '@/types/onboarding'

export function AdminUserStep() {
  const { state, updateAdminUser } = useOnboarding()

  if (!state) return null

  const user = state.data.adminUser

  const handleChange = (field: keyof UserSetup, value: string) => {
    updateAdminUser({ [field]: value })
  }

  const passwordsMatch = user.password === user.confirmPassword
  const passwordValid = user.password.length >= 12

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This admin account will have full system access. Add role-specific staff users after setup.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="userName">Full Name *</Label>
          <Input
            id="userName"
            value={user.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="Full name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="userEmail">Email *</Label>
          <Input
            id="userEmail"
            type="email"
            value={user.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="admin@property.com"
          />
          <p className="text-xs text-muted-foreground">
            This email will be used for login.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="userPhone">Phone</Label>
          <Input
            id="userPhone"
            value={user.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="+66 8 0000 0000"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password *</Label>
            <Input
              id="password"
              type="password"
              value={user.password}
              onChange={(e) => handleChange('password', e.target.value)}
              placeholder="Minimum 12 characters"
            />
            {user.password && !passwordValid && (
              <p className="text-xs text-destructive">
                Password must be at least 12 characters.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password *</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={user.confirmPassword}
              onChange={(e) => handleChange('confirmPassword', e.target.value)}
              placeholder="Confirm password"
            />
            {user.confirmPassword && !passwordsMatch && (
              <p className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
