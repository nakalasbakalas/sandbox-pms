import { useEffect, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import { Plus, Trash, UserCircle, Shield, Key, PencilSimple, ArrowClockwise } from '@phosphor-icons/react'
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
import { SERVER_AUTH_ENABLED, normalizeAuthEmail } from '@/lib/auth-mode'
import { createServerUser, deactivateServerUser, listServerUsers, updateServerUser } from '@/lib/server-auth-client'

type ManagedUser = User & Partial<PasswordCredential>

const emptyForm = {
  username: '',
  email: '',
  password: '',
  displayName: '',
  role: 'front-desk' as UserRole,
}

function loginIdFor(user?: Pick<User, 'username' | 'email'> | null) {
  return normalizeAuthEmail(user?.username || user?.email || '')
}

function emailFor(user?: Pick<User, 'email'> | null) {
  return user?.email ? normalizeAuthEmail(user.email) : ''
}

function validEmail(email: string) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function UserManagementView() {
  const [localUsers, setLocalUsers] = useKV<ManagedUser[]>('system:users', [])
  const [serverUsers, setServerUsers] = useState<ManagedUser[]>([])
  const [serverLoading, setServerLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null)
  const { user: currentUser } = useAuth()

  const [formData, setFormData] = useState(emptyForm)
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  })

  const users = SERVER_AUTH_ENABLED ? serverUsers : localUsers

  const loadUsers = async () => {
    if (!SERVER_AUTH_ENABLED) return
    setServerLoading(true)
    setServerError(null)
    try {
      setServerUsers(await listServerUsers())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load users.'
      setServerError(message)
      toast.error(message)
    } finally {
      setServerLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const resetForm = () => {
    setFormData(emptyForm)
    setSelectedUser(null)
  }

  const resetPasswordForm = () => {
    setPasswordForm({
      newPassword: '',
      confirmPassword: '',
    })
  }

  const validateUserForm = (requirePassword: boolean) => {
    const username = normalizeAuthEmail(formData.username || formData.email)
    const email = emailFor(formData)

    if (!username) {
      toast.error('Enter a login username. Email is optional.')
      return null
    }
    if (!validEmail(email)) {
      toast.error('Enter a valid email address or leave email blank.')
      return null
    }
    if (requirePassword && !formData.password) {
      toast.error('Enter a temporary password.')
      return null
    }
    if (requirePassword && formData.password.length < 12) {
      toast.error('Temporary password must be at least 12 characters.')
      return null
    }
    if (!formData.displayName.trim()) {
      toast.error('Enter a display name.')
      return null
    }
    return { username, email: email || null, displayName: formData.displayName.trim() }
  }

  const handleAddUser = async () => {
    const normalized = validateUserForm(true)
    if (!normalized) return

    if (!SERVER_AUTH_ENABLED) {
      if (localUsers.some((user) => loginIdFor(user) === normalized.username || (normalized.email && emailFor(user) === normalized.email))) {
        toast.error('User login already exists.')
        return
      }

      const passwordSalt = createPasswordSalt()
      const passwordHash = await hashPassword(formData.password, passwordSalt)
      const newUser: ManagedUser = {
        id: `user-${Date.now()}`,
        username: normalized.username,
        email: normalized.email,
        passwordHash,
        passwordSalt,
        displayName: normalized.displayName,
        role: formData.role,
        active: true,
        createdAt: new Date().toISOString(),
      }

      setLocalUsers((current) => [...current, newUser])
      toast.success(`User ${normalized.username} created successfully`)
      setIsAddDialogOpen(false)
      resetForm()
      return
    }

    try {
      const user = await createServerUser({
        username: normalized.username,
        email: normalized.email,
        password: formData.password,
        displayName: normalized.displayName,
        role: formData.role,
        active: true,
      })
      setServerUsers((current) => [...current, user].sort((a, b) => loginIdFor(a).localeCompare(loginIdFor(b))))
      toast.success(`User ${loginIdFor(user)} created successfully`)
      setIsAddDialogOpen(false)
      resetForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create user.')
    }
  }

  const handleEditUser = async () => {
    if (!selectedUser) return
    const normalized = validateUserForm(false)
    if (!normalized) return

    if (!SERVER_AUTH_ENABLED) {
      setLocalUsers((current) =>
        current.map((user) =>
          user.id === selectedUser.id
            ? { ...user, username: normalized.username, email: normalized.email, displayName: normalized.displayName, role: formData.role }
            : user
        )
      )
      toast.success('User updated successfully')
      setIsEditDialogOpen(false)
      resetForm()
      return
    }

    try {
      const updatedUser = await updateServerUser(selectedUser.id, {
        username: normalized.username,
        email: normalized.email,
        displayName: normalized.displayName,
        role: formData.role,
      })
      setServerUsers((current) => current.map((user) => user.id === selectedUser.id ? updatedUser : user))
      toast.success('User updated successfully')
      setIsEditDialogOpen(false)
      resetForm()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update user.')
    }
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

    if (passwordForm.newPassword.length < 12) {
      toast.error('Password must be at least 12 characters')
      return
    }

    if (!SERVER_AUTH_ENABLED) {
      const passwordSalt = createPasswordSalt()
      const passwordHash = await hashPassword(passwordForm.newPassword, passwordSalt)
      setLocalUsers((current) =>
        current.map((user) =>
          user.id === selectedUser.id
            ? { ...user, passwordHash, passwordSalt }
            : user
        )
      )
      toast.success('Password changed successfully')
      setIsPasswordDialogOpen(false)
      resetPasswordForm()
      setSelectedUser(null)
      return
    }

    try {
      await updateServerUser(selectedUser.id, { password: passwordForm.newPassword })
      toast.success('Password changed successfully')
      setIsPasswordDialogOpen(false)
      resetPasswordForm()
      setSelectedUser(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change password.')
    }
  }

  const openEditDialog = (user: ManagedUser) => {
    setSelectedUser(user)
    setFormData({
      username: loginIdFor(user),
      email: emailFor(user),
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

  const handleDeleteUser = async (userId: string) => {
    const user = users.find((candidate) => candidate.id === userId)
    if (!user) return

    if (user.id === currentUser?.id) {
      toast.error('Cannot deactivate your own account')
      return
    }

    if (!SERVER_AUTH_ENABLED) {
      setLocalUsers((current) => current.filter((candidate) => candidate.id !== userId))
      toast.success(`User ${loginIdFor(user)} deleted`)
      return
    }

    try {
      const deactivatedUser = await deactivateServerUser(user.id)
      setServerUsers((current) => current.map((candidate) => candidate.id === user.id ? deactivatedUser : candidate))
      toast.success(`User ${loginIdFor(user)} deactivated`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not deactivate user.')
    }
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

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="text-primary" />
            User Management
          </h1>
          <p className="text-muted-foreground mt-1">
            {SERVER_AUTH_ENABLED
              ? 'Manage database staff accounts. Email is optional; every user needs a unique login username.'
              : 'Manage local development users. Email is optional; every user needs a unique login username.'}
          </p>
        </div>

        <div className="flex gap-2">
          {SERVER_AUTH_ENABLED && (
            <Button variant="outline" onClick={() => void loadUsers()} disabled={serverLoading}>
              <ArrowClockwise className="mr-2" />
              Refresh
            </Button>
          )}

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
                  Add a staff account with a username. Email can be left blank for staff without email addresses.
                </DialogDescription>
              </DialogHeader>

              <UserFormFields formData={formData} setFormData={setFormData} includePassword />

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

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update login, display name, and role for {selectedUser ? loginIdFor(selectedUser) : 'this user'}
              </DialogDescription>
            </DialogHeader>

            <UserFormFields formData={formData} setFormData={setFormData} />

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
                Set a new password for {selectedUser ? loginIdFor(selectedUser) : 'this user'}
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
                  onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })}
                />
              </div>

              {passwordForm.newPassword && passwordForm.newPassword.length < 12 && (
                <p className="text-sm text-destructive">Password must be at least 12 characters</p>
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

      {SERVER_AUTH_ENABLED && serverError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{serverError}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Staff Accounts</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} {SERVER_AUTH_ENABLED ? 'in the database' : 'in the local development store'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serverLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No users created.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className={user.active === false ? 'opacity-60' : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserCircle className="text-muted-foreground" size={20} />
                        <span className="font-medium">{user.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{loginIdFor(user)}</code>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {emailFor(user) || 'Not recorded'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {ROLE_LABELS[user.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active === false ? 'outline' : 'secondary'}>
                        {user.active === false ? 'Inactive' : 'Active'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Not recorded'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => openEditDialog(user)} disabled={user.active === false}>
                          <PencilSimple size={16} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openPasswordDialog(user)} disabled={user.active === false}>
                          <Key size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDeleteUser(user.id)}
                          disabled={user.id === currentUser?.id || user.active === false}
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

function UserFormFields({
  formData,
  setFormData,
  includePassword = false,
}: {
  formData: typeof emptyForm
  setFormData: (value: typeof emptyForm) => void
  includePassword?: boolean
}) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="username">Login username</Label>
        <Input
          id="username"
          type="text"
          placeholder="hm, hk1, frontdesk, or staff email"
          value={formData.username}
          onChange={(event) => setFormData({ ...formData, username: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email (optional)</Label>
        <Input
          id="email"
          type="email"
          placeholder="staff@property.com"
          value={formData.email}
          onChange={(event) => setFormData({ ...formData, email: event.target.value })}
        />
      </div>

      {includePassword && (
        <div className="space-y-2">
          <Label htmlFor="password">Temporary password</Label>
          <Input
            id="password"
            type="password"
            placeholder="At least 12 characters"
            value={formData.password}
            onChange={(event) => setFormData({ ...formData, password: event.target.value })}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="displayName">Display Name</Label>
        <Input
          id="displayName"
          placeholder="Enter display name"
          value={formData.displayName}
          onChange={(event) => setFormData({ ...formData, displayName: event.target.value })}
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
  )
}
