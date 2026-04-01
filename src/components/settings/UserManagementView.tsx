import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useKV } from '@github/spark/hooks'
import { Plus, Trash, UserCircle, Shield, Key } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { User, UserRole } from '@/types/auth'
import { ROLE_LABELS, ROLE_PERMISSIONS } from '@/types/auth'
import { useAuth } from '@/hooks/use-auth'

interface UserWithPassword extends User {
  password: string
}

export function UserManagementView() {
  const [users, setUsers] = useKV<UserWithPassword[]>('system:users', [])
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserWithPassword | null>(null)
  const { user: currentUser } = useAuth()

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    displayName: '',
    role: 'front-desk' as UserRole,
  })

  const resetForm = () => {
    setFormData({
      username: '',
      password: '',
      displayName: '',
      role: 'front-desk',
    })
    setSelectedUser(null)
  }

  const handleAddUser = () => {
    if (!formData.username || !formData.password || !formData.displayName) {
      toast.error('Please fill in all fields')
      return
    }

    if (users.some(u => u.username === formData.username)) {
      toast.error('Username already exists')
      return
    }

    const newUser: UserWithPassword = {
      id: `user-${Date.now()}`,
      username: formData.username,
      password: formData.password,
      displayName: formData.displayName,
      role: formData.role,
      createdAt: new Date().toISOString(),
    }

    setUsers((current) => [...current, newUser])
    toast.success(`User ${formData.username} created successfully`)
    setIsAddDialogOpen(false)
    resetForm()
  }

  const handleDeleteUser = (userId: string) => {
    const user = users.find(u => u.id === userId)
    if (!user) return

    if (user.id === currentUser?.id) {
      toast.error('Cannot delete your own account')
      return
    }

    setUsers((current) => current.filter(u => u.id !== userId))
    toast.success(`User ${user.username} deleted`)
  }

  const getRoleBadgeVariant = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'default'
      case 'manager':
        return 'secondary'
      case 'front-desk':
        return 'outline'
      case 'housekeeping':
        return 'outline'
      case 'cashier':
        return 'outline'
      default:
        return 'outline'
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="text-primary" />
            User Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage system users and their permissions
          </p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Add a new user account to the system
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="Enter username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  placeholder="Enter display name"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => setFormData({ ...formData, role: value as UserRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([role, label]) => (
                      <SelectItem key={role} value={role}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddUser}>
                Create User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No custom users created. Using default system accounts.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserCircle className="text-muted-foreground" size={20} />
                        <span className="font-medium">{user.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{user.username}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={user.id === currentUser?.id}
                      >
                        <Trash className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default System Accounts</CardTitle>
          <CardDescription>
            Built-in accounts for testing and initial setup
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">Neeq</code></TableCell>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">Neeq!1234</code></TableCell>
                <TableCell><Badge variant="default">Administrator</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">Full system access</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">manager</code></TableCell>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">manager123</code></TableCell>
                <TableCell><Badge variant="secondary">Manager</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROLE_PERMISSIONS.manager.length} permissions</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">frontdesk</code></TableCell>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">frontdesk123</code></TableCell>
                <TableCell><Badge variant="outline">Front Desk</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROLE_PERMISSIONS['front-desk'].length} permissions</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">housekeeping</code></TableCell>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">housekeeping123</code></TableCell>
                <TableCell><Badge variant="outline">Housekeeping</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROLE_PERMISSIONS.housekeeping.length} permissions</TableCell>
              </TableRow>
              <TableRow>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">cashier</code></TableCell>
                <TableCell><code className="text-xs bg-muted px-2 py-1 rounded">cashier123</code></TableCell>
                <TableCell><Badge variant="outline">Cashier</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{ROLE_PERMISSIONS.cashier.length} permissions</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="text-primary" />
            Role Permissions
          </CardTitle>
          <CardDescription>
            Overview of permissions for each role
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => (
              <div key={role} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{ROLE_LABELS[role as UserRole]}</h3>
                  <Badge variant="outline">{permissions.length} permissions</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {permissions.map((permission) => (
                    <Badge key={permission} variant="secondary" className="text-xs">
                      {permission}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
