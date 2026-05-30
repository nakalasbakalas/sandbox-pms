# Authentication & Role-Based Access Control

## Overview

The Sandbox Hotel PMS implements a comprehensive role-based access control (RBAC) system that ensures users only have access to the features and data they need for their job function. The system provides five distinct user roles with granular permission controls.

## System Architecture

### Components

1. **Authentication Provider** (`/src/hooks/use-auth.tsx`)
   - Manages authentication state
   - Handles login/logout operations
   - Provides permission checking utilities
   - Persists user sessions using KV storage

2. **Type Definitions** (`/src/types/auth.ts`)
   - User and role type definitions
   - Permission enumeration
   - Role-permission mappings

3. **Login Screen** (`/src/components/auth/LoginScreen.tsx`)
   - Beautiful branded login interface
   - Accepts staff credentials without displaying shared account passwords
   - Form validation and error handling

4. **Permission Gate** (`/src/components/auth/PermissionGate.tsx`)
   - Component-level permission control
   - Conditionally renders UI based on permissions
   - Supports single, any-of, or all-of permission checks

5. **User Profile Menu** (`/src/components/navigation/UserProfileMenu.tsx`)
   - Displays current user information
   - Shows role badge
   - Quick logout access

6. **User Management View** (`/src/components/settings/UserManagementView.tsx`)
   - Admin-only user management interface
   - Create, view, and delete user accounts
   - View role permissions

## User Roles

### Admin
**Email:** `admin@sandboxhotel.co.th`
**Password:** Managed outside the application UI

**Permissions:** All 27 system permissions
- Complete system access
- User management
- Financial controls
- System configuration
- All operational features

### Manager
**Email:** `manager@sandboxhotel.co.th`
**Password:** Managed outside the application UI

**Permissions:** 23 permissions
- Reservation management
- Rate editing
- Night audit
- Financial reports
- Guest operations
- Cannot: manage users, edit settings, process refunds

### Front Desk
**Email:** `frontdesk@sandboxhotel.co.th`
**Password:** Managed outside the application UI

**Permissions:** 13 permissions
- Guest check-in/check-out
- Reservation creation/editing
- Payment processing
- Room status updates
- Guest messaging
- Cannot: edit rates, cancel reservations, view financial reports, access settings

### Housekeeping
**Email:** `housekeeping@sandboxhotel.co.th`
**Password:** Managed outside the application UI

**Permissions:** 5 permissions (minimal access)
- View board
- Edit room status
- View housekeeping module
- Staff messaging
- Cannot: view guest details, access reservations, view reports

### Cashier
**Email:** `cashier@sandboxhotel.co.th`
**Password:** Managed outside the application UI

**Permissions:** 11 permissions
- Payment processing
- Post charges
- Financial reports
- View guests/reservations
- Cannot: check-in/check-out, edit reservations, process refunds, run night audit

## Permission System

### Permission Categories

**View Permissions** (13 total)
```typescript
'view:board'
'view:reservations'
'view:guests'
'view:reports'
'view:settings'
'view:cashier'
'view:housekeeping'
'view:rates'
'view:channels'
'view:analytics'
'view:night-audit'
'view:messaging'
```

**Action Permissions** (14 total)
```typescript
'create:reservation'
'edit:reservation'
'cancel:reservation'
'check-in:guest'
'check-out:guest'
'edit:rates'
'edit:room-status'
'post:charges'
'process:payment'
'refund:payment'
'run:night-audit'
'edit:settings'
'manage:users'
'edit:inventory'
'manage:channels'
'send:guest-messages'
'send:staff-messages'
```

### Permission Checking

**In React Components:**
```typescript
import { useAuth } from '@/hooks/use-auth'

function MyComponent() {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = useAuth()
  
  // Check single permission
  if (hasPermission('edit:rates')) {
    // Show rate editing UI
  }
  
  // Check any of multiple permissions
  if (hasAnyPermission(['view:reports', 'view:analytics'])) {
    // Show analytics
  }
  
  // Check all permissions required
  if (hasAllPermissions(['edit:reservation', 'cancel:reservation'])) {
    // Show advanced reservation management
  }
}
```

**Using Permission Gate:**
```typescript
import { PermissionGate } from '@/components/auth/PermissionGate'

// Single permission
<PermissionGate permission="edit:rates">
  <RateEditor />
</PermissionGate>

// Any of multiple permissions
<PermissionGate anyOf={['view:reports', 'view:analytics']}>
  <ReportsView />
</PermissionGate>

// All permissions required
<PermissionGate allOf={['edit:reservation', 'cancel:reservation']}>
  <AdvancedReservationTools />
</PermissionGate>

// With fallback content
<PermissionGate 
  permission="manage:users" 
  fallback={<p>You don't have permission to view this.</p>}
>
  <UserManagement />
</PermissionGate>
```

## Navigation Integration

The sidebar automatically filters navigation items based on user permissions:

```typescript
// In AppSidebar.tsx
const primaryNavItems = [
  { id: 'board', label: 'Board', icon: SquaresFour, permission: 'view:board' },
  { id: 'reservations', label: 'Reservations', icon: CalendarBlank, permission: 'view:reservations' },
  // ... more items
]

// Items are filtered before rendering
{primaryNavItems.filter(canViewItem).map((item) => (
  <SidebarMenuItem key={item.id}>
    {/* Render navigation item */}
  </SidebarMenuItem>
))}
```

## User Management

### Creating Users (Admin Only)

1. Navigate to Settings → User Management (visible only to admins)
2. Click "Add User" button
3. Fill in user details:
   - Email address (must be unique)
   - Password
   - Display Name
   - Role (Admin, Manager, Front Desk, Housekeeping, Cashier)
4. Click "Create User"

The new user will immediately be able to log in with their credentials.

### Seeded System Accounts

Server mode uses database-backed email accounts only. Real staff/admin accounts should be seeded with `SEED_USERS_JSON` using approved emails and password hashes, or created through a controlled admin/database process. Do not use `.local` demo identities for deployed access.

### Deleting Users

1. Navigate to User Management
2. Find the user in the list
3. Click the trash icon
4. User is immediately removed

**Restrictions:**
- Cannot delete your own account
- Cannot delete default system accounts (they're not shown in the custom users list)

## Session Management

### Login Flow

1. User enters email and password
2. Credentials are validated against the server session endpoint in deployed mode or against local development demo accounts in local mode
3. On success:
   - User object is created and stored in KV (`auth:current-user`)
   - Session persists across page refreshes
   - User is redirected to main application
4. On failure:
   - Error toast is shown
   - User remains on login screen

### Logout Flow

1. User clicks their profile menu -> Sign Out
2. Current user is removed from KV storage
3. Authentication state is cleared
4. User is redirected to login screen

### Session Persistence

User sessions are stored using the Spark KV API:
- **Key:** `auth:current-user`
- **Value:** User object (email, role, displayName, etc.)
- **Lifecycle:** Persists until explicit logout
- **Scope:** Per-browser, per-user

## Security Considerations

### Current Implementation

- **Implemented:**
- Role-based access control
- Permission-based UI rendering
- Session persistence
- User management for local development fallback only
- Granular permission system
- Password-protected accounts

- **Limitations:**
- Authentication and RBAC run through the backend in deployed/server mode
- Built-in bootstrap accounts are local-development only and do not ship as production login identities
- No session expiration is currently enforced
- No 2FA/MFA is currently enforced
- No password reset flow (admin can recreate users)

### Production Considerations

For a production deployment, consider:
1. **Server-Side Authorization:** Enforce every permission check on API routes/services
2. **Password Security:** Store backend passwords with a slow adaptive hash such as Argon2id or bcrypt
3. **Session Timeout:** Implement inactivity timeout (e.g., 8 hours)
4. **Audit Logging:** Track user actions for compliance
5. **Password Policy:** Enforce minimum password requirements
6. **Account Lockout:** Prevent brute force attacks
7. **Two-Factor Auth:** Optional for admin accounts

## UI Adaptation by Role

### Admin View
- All navigation items visible
- User Management menu item in sidebar
- All action buttons enabled
- Complete system access

### Manager View
- Most navigation items visible
- No User Management menu
- Most action buttons enabled
- Cannot edit system settings

### Front Desk View
- Core operational views visible
- No analytics or advanced features
- Limited to guest-facing operations
- No rate editing capabilities

### Housekeeping View
- Minimal UI (board + housekeeping)
- Simplified room status controls
- No access to guest details
- Task-focused interface

### Cashier View
- Payment and financial focus
- Access to transactions and reports
- Cannot manage reservations
- View-only for guest data

## Testing

### Test Each Role

1. **Login as Admin:**
   - Use the configured admin credentials
   - Verify: All menus visible, User Management accessible

2. **Login as Manager:**
   - Use the configured manager credentials
   - Verify: No User Management, can edit rates, can run night audit

3. **Login as Front Desk:**
   - Use the configured front desk credentials
   - Verify: Limited menus, can check-in/out, cannot edit rates

4. **Login as Housekeeping:**
   - Use the configured housekeeping credentials
   - Verify: Minimal UI, only board and housekeeping visible

5. **Login as Cashier:**
   - Use the configured cashier credentials
   - Verify: Can view reports, process payments, cannot check-in guests

### Test User Management

1. Login as Admin
2. Navigate to User Management
3. Create a new Front Desk user
4. Logout and login as the new user
5. Verify permissions are correct
6. Login as Admin and delete the test user

## Future Enhancements

Potential improvements to the auth system:

1. **Audit Trail:** Log all user actions with timestamps
2. **Permission Groups:** Create custom permission sets
3. **Shift Management:** Track user shift start/end times
4. **Multi-Property:** Support users across multiple properties
5. **API Tokens:** Generate tokens for external integrations
6. **SSO Integration:** Support SAML/OAuth for enterprise
7. **Custom Roles:** Allow admins to create custom roles
8. **Temporary Access:** Grant time-limited permissions
9. **Password Expiration:** Force periodic password changes
10. **Login History:** Track login attempts and sessions

## Troubleshooting

### Cannot Login
- Verify the email address is exactly as shown (case-sensitive)
- Check password matches exactly (case-sensitive)
- Clear browser storage and try again
- Check browser console for errors

### Missing Menu Items
- Verify your role has the required permissions
- Check the permission mappings in `auth.ts`
- Logout and login again to refresh permissions

### User Management Not Visible
- Only visible to Admin role
- Verify you're logged in as `admin@sandboxhotel.co.th` or another admin account

### Session Lost on Refresh
- Check session storage is working correctly
- Verify `auth:current-user` key exists in storage
- Check for JavaScript errors in console

## Code Reference

**Key Files:**
- `/src/types/auth.ts` - Type definitions and role permissions
- `/src/hooks/use-auth.tsx` - Authentication provider and logic
- `/src/components/auth/LoginScreen.tsx` - Login UI
- `/src/components/auth/PermissionGate.tsx` - Permission wrapper component
- `/src/components/navigation/UserProfileMenu.tsx` - User menu
- `/src/components/settings/UserManagementView.tsx` - Admin user management
- `/src/App.tsx` - Authentication integration
- `/src/components/navigation/AppSidebar.tsx` - Permission-based navigation

**Usage Examples:**
See the `AppSidebar.tsx` and `UserManagementView.tsx` files for real-world examples of permission checking and UI adaptation.
