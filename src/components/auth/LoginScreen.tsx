import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'
import { KeyIcon, UserCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const success = await login(username, password)
      
      if (success) {
        toast.success('Login successful')
      } else {
        toast.error('Invalid username or password')
      }
    } catch (error) {
      toast.error('An error occurred during login')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/5 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">Sandbox Hotel PMS</h1>
          <p className="text-muted-foreground">Property Management System</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="text-primary" size={24} />
              Sign In
            </CardTitle>
            <CardDescription>
              Enter your credentials to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  autoFocus
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <KeyIcon className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t space-y-3">
              <p className="text-xs text-muted-foreground font-semibold">Demo Accounts:</p>
              <div className="grid gap-2 text-xs text-muted-foreground">
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                  <span className="font-medium">Admin:</span>
                  <span className="font-mono">Neeq / Neeq!1234</span>
                </div>
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                  <span className="font-medium">Manager:</span>
                  <span className="font-mono">manager / manager123</span>
                </div>
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                  <span className="font-medium">Front Desk:</span>
                  <span className="font-mono">frontdesk / frontdesk123</span>
                </div>
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                  <span className="font-medium">Housekeeping:</span>
                  <span className="font-mono">housekeeping / housekeeping123</span>
                </div>
                <div className="flex justify-between items-center bg-muted/30 p-2 rounded">
                  <span className="font-medium">Cashier:</span>
                  <span className="font-mono">cashier / cashier123</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
