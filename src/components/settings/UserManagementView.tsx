import { useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Plus, Trash, UserCircle, Shield, Key, PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { User, UserRole } from '@/types/auth'
import { ROLE_LABELS, ROLE_PERMISSIONS } from '@/types/auth'
import { useAuth } from '@/hooks/use-auth'
import { createPasswordSalt, hashPassword, type PasswordCredential } from '@/lib/auth-passwords'
import { LOCAL_AUTH_FALLBACK_ENABLED, SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'

interface ManagedUser extends User, PasswordCredential {}

const DEFAULT_DEMO_USERS = [
  { email: 'admin@sandboxhotel.local', role: 'Administrator', permissions: ROLE_PERMISSIONS.admin.length },
  { email: 'manager@sandboxhotel.local', role: 'Manager', permissions: ROLE_PERMISSIONS.manager.length },
  { email: 'frontdesk@sandboxhotel.local', role: 'Front Desk', permissions: ROLE_PERMISSIONS['front-desk'].length },
  { email: 'housekeeping@sandboxhotel.local', role: 'Housekeeping', permissions: ROLE_PERMISSIONS.housekeeping.length },
  { email: 'cashier@sandboxhotel.local', role: 'Cashier', permissions: ROLE_PERMISSIONS.cashier.length },
]

export function UserManagementView() {
  const [users, setUsers] = useKV<ManagedUser[]>('system:users', [])
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null)
  const { user: currentUser } = useAuth()

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'front-desk' as UserRole,
  })

  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  })

  const resetForm = () => {
    setFormData({
      email: '',
      password: '',
      displayName: '',
      role: 'front-desk',
    })
    setSelectedUser(null)
  }

  const resetPasswordForm = () => {
    setPasswordForm({
      newPassword: '',
      confirmPassword: '',
    })
  }

  const handleAddUser = async () => {
    const email = normalizeAuthEmail(formData.email)

    if (!email || !formData.password || !formData.displayName) {
      toast.error('Please fill in all fields')
      return
    }

    if (users.some((u) => normalizeAuthEmail(u.email || u.username) === email)) {
      toast.error('Email already exists')
      return
    }

    const passwordSalt = createPasswordSalt()
    const passwordHash = await hashPassword(formData.password, passwordSalt)
    const newUser: ManagedUser = {
      id: `user-${Date.now()}`,
      email,
      username: email,
      passwordHash,
      passwordSalt,
      displayName: formData.displayName,
      role: formData.role,
      createdAt: new Date().toISOString(),
    }

    setUsers((current) => [...current, newUser])
    toast.success(`User ${email} created successfully`)
    setIsAddDialogOpen(false)
    resetForm()
  }

  const handleEditUser = () => {
    if (!selectedUser) return

    setUsers((current) =>
      current.map((u) =>
        u.id === selectedUser.id
          ? { ...u, displayName: formData.displayName, role: formData.role }
          : u
      )
    )
    toast.success('User updated successfully')
    setIsEditDialogOpen(false)
    resetForm()
  }

  const handleChangePassword = async () => {
    if (!selectedUser) return

    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('Please fill in all fields')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (passwordForm.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    const passwordSalt = createPasswordSalt()
    const passwordHash = await hashPassword(passwordForm.newPassword, passwordSalt)

    setUsers((current) =>
      current.map((u) =>
        u.id === selectedUser.id
          ? { ...u, passwordHash, passwordSalt }
          : u
      )
    )
    toast.success('Password changed successfully')
    setIsPasswordDialogOpen(false)
    resetPasswordForm()
    setSelectedUser(null)
  }

  const openEditDialog = (user: ManagedUser) => {
    setSelectedUser(user)
    setFormData({
      email: normalizeAuthEmail(user.email || user.username),
      password: '',
      displayName: user.displayName,
      role: user.role,
    })
    setIsEditDialogOpen(true)
  }

  const openPasswordDialog = (user: ManagedUser) => {
    setSelectedUser(user)
    resetPasswordForm()
    setIsPasswordDialogOpen(true)
  }

  const handleDeleteUser = (userId: string) => {
    const user = users.find((u) => u.id === userId)
    if (!user) return

    if (user.id === currentUser?.id) {
      toast.error('Cannot delete your own account')
      return
    }

    setUsers((current) => current.filter((u) => u.id !== userId))
    toast.success(`User ${normalizeAuthEmail(user.email || user.username)} deleted`)
  }

  const getRoleBadgeVariant = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'default'
      case 'manager':
        return 'secondary'
      default:
        return 'outline'
    }
  }

  if (SERVER_AUTH_ENABLED) {
    return (
      <Card className="m-6">
        <CardHeader>
          <CardTitle>Server-authenticated users</CardTitle>
          <CardDescription>
            Email-based staff accounts are managed in the database for deployed mode. The local browser user manager is disabled here so dev-only KV accounts cannot leak into production behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Use the Prisma seed flow to create or rotate staff accounts, then sign in with the configured email address.
          </p>
          <p>
            Local-only fallback accounts remain available in development builds only.
          </p>
        </CardContent>
      </Card>
    )
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
            Manage local development users by email. These accounts are not used in server mode.
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
                Add a new local development account using an email address
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="staff@sandboxhotel.local"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
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

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update display name and role for {selectedUser?.email || selectedUser?.username}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  value={formData.email}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-displayName">Display Name</Label>
                <Input
                  id="edit-displayName"
                  placeholder="Enter display name"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-role">Role</Label>
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
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditUser}>
                Update User
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Password</DialogTitle>
              <DialogDescription>
                Set a new password for {selectedUser?.email || selectedUser?.username}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                />
              </div>

              {passwordForm.newPassword && passwordForm.newPassword.length < 6 && (
                <p className="text-sm text-destructive">Password must be at least 6 characters</p>
              )}

              {passwordForm.newPassword && passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                <p className="text-sm text-destructive">Passwords do not match</p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsPasswordDialogOpen(false); resetPasswordForm(); }}>
                Cancel
              </Button>
              <Button onClick={handleChangePassword}>
                Change Password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} in the local development store
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No local users created. Use the development demo accounts instead.
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
                      <code className="text-xs bg-muted px-2 py-1 rounded">{normalizeAuthEmail(user.email || user.username)}</code>
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
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                        >
                          <PencilSimple size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPasswordDialog(user)}
                        >
                          <Key size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={user.id === currentUser?.id}
                        >
                          <Trash size={16} className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {LOCAL_AUTH_FALLBACK_ENABLED && (
        <Card>
          <CardHeader>
            <CardTitle>Development Demo Accounts</CardTitle>
            <CardDescription>
              These email-based accounts are available only in local development mode.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Permissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DEFAULT_DEMO_USERS.map((account) => (
                  <TableRow key={account.email}>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{account.email}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={account.role === 'Administrator' ? 'default' : account.role === 'Manager' ? 'secondary' : 'outline'}>
                        {account.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {account.permissions} permissions
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
