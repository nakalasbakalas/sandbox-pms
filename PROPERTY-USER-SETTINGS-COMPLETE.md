# Property and User Settings - Complete Implementation

## Overview

The Property and User Settings modules are now fully implemented, providing comprehensive configuration capabilities for the Sandbox Hotel PMS. These settings form the foundation of the system's customization and security features.

## Property Settings

### Location: Settings → Property Tab

The Property Settings module provides complete control over hotel configuration and operational parameters.

### Features Implemented

#### 1. Property Information
- **Property Name**: Hotel name displayed throughout the system
- **Tax ID / Registration Number**: Official business identification
- **Contact Details**:
  - Street address
  - City and country
  - Phone number (with icon)
  - Email address (with icon)
  - Website URL (optional)

#### 2. Location Details
- Structured address input with separate fields
- City and country configuration
- Clear visual grouping with separator

#### 3. Operating Settings
- **Time Zone**: Dropdown selection of common Asian time zones
  - Asia/Bangkok (default)
  - Asia/Singapore
  - Asia/Hong_Kong
  - Asia/Tokyo
  - Asia/Seoul
  - Asia/Shanghai
  - UTC
  
- **Currency**: Multi-currency support
  - THB (Thai Baht) - default
  - USD, EUR, GBP, SGD, JPY
  
- **Check-In/Check-Out Times**: Time picker inputs
  - Default check-in: 14:00
  - Default check-out: 11:00

#### 4. Branding & Receipts
- **Brand Color**: Color picker with hex code input
  - Visual preview
  - Used in receipts and branding
  - Default: #B87333 (copper)
  
- **Receipt Footer Text**: Multi-line text area
  - Custom message for all receipts/invoices
  - Example: "Thank you for staying with us!"

#### 5. Room Configuration Summary
- Visual display of configured room types
- Count of rooms per type
- Total room count
- Available room count
- Quick link to Room Type Management

### Data Persistence
- All settings stored in KV store under `onboarding-property`
- Edit mode with save/cancel functionality
- Real-time updates without page refresh
- Toast notifications for success/errors

---

## Room Type Management

### Location: Settings → Rooms Tab

Complete room type and room inventory management system.

### Features Implemented

#### 1. Room Type Configuration

**Room Type Creation/Editing**:
- Room type name (e.g., "Twin Room", "Double Room")
- Base occupancy (default: 2)
- Maximum occupancy (default: 3)
- Extra guest fee in THB (default: 200)
- Child fee policies:
  - Child free age (0-X, default: 5)
  - Child fee age limit (default: 11)
  - Child fee amount (default: 100 THB)

**Room Type Table Display**:
- Name
- Occupancy (base/max with icon)
- Extra guest fee with currency icon
- Child fee policy summary
- Room count per type
- Edit and delete actions

**Room Type Actions**:
- Add new room type
- Edit existing room type
- Delete room type (prevented if rooms assigned)

#### 2. Room Inventory Management

**Bulk Room Creation**:
- Select room type from dropdown
- Enter start room number (e.g., 201)
- Enter end room number (e.g., 215)
- Automatic calculation of room count
- Creates all rooms in range at once

**Room Display**:
- Grouped by room type
- Grid layout (8 columns)
- Shows room number
- Status badge (OK/OOS)
- Hover actions for deletion
- Visual room cards with borders

**Room Features**:
- Duplicate detection (prevents duplicate room numbers)
- Individual room deletion
- Room status indicator
- Organized by room type sections

### Data Persistence
- Room types stored in `onboarding-room-types`
- Rooms stored in `onboarding-rooms`
- Functional state updates for real-time reactivity
- Validation before saves

---

## User Management

### Location: Settings → Advanced → Manage Users

Comprehensive user account and permission management.

### Features Implemented

#### 1. User Account Management

**Create New User**:
- Username (unique, required)
- Password (required, minimum 6 characters)
- Display name (required)
- Role selection (dropdown)
- Automatic ID generation
- Created timestamp

**Edit Existing User**:
- Update display name
- Change role
- Username locked (read-only in edit mode)
- Cannot edit own account role

**Change User Password**:
- New password input
- Confirm password input
- Password validation (6+ characters)
- Password match validation
- Visual feedback for errors

**Delete User**:
- Confirmation required
- Cannot delete own account
- Removes user from system

#### 2. User Table Display

**Columns**:
- User (display name with icon)
- Username (code badge)
- Role (color-coded badge)
- Created date
- Actions (Edit, Password, Delete)

**Action Buttons**:
- Edit (pencil icon) - opens edit dialog
- Password (key icon) - opens password change dialog
- Delete (trash icon) - deletes user with protection

#### 3. Default System Accounts

**Built-in Accounts Table**:
- Neeq / Neeq!1234 (Administrator)
- manager / manager123 (Manager)
- frontdesk / frontdesk123 (Front Desk)
- housekeeping / housekeeping123 (Housekeeping)
- cashier / cashier123 (Cashier)

**Display Information**:
- Username (code badge)
- Password (code badge)
- Role badge
- Permission count per role

#### 4. Role Permissions Overview

**Permission Display by Role**:
- Role name header
- Permission count badge
- All permissions listed as chips/badges
- Organized by role

**Permission Categories**:
- View permissions (board, reservations, guests, etc.)
- Create/Edit permissions (reservation, rates, etc.)
- Action permissions (check-in, check-out, payments, etc.)
- Admin permissions (settings, users, channels, etc.)

### Role Definitions

#### Administrator
- Full system access (27 permissions)
- All modules and features
- User management
- Settings configuration

#### Manager
- Operational management (21 permissions)
- All operational modules
- Cannot manage users
- Cannot edit system settings

#### Front Desk
- Guest-facing operations (12 permissions)
- Reservations, check-in/check-out
- Guest management
- Payment processing
- Messaging

#### Housekeeping
- Room operations (5 permissions)
- View board
- Update room status
- Messaging
- Limited access

#### Cashier
- Financial operations (10 permissions)
- Payment processing
- Charge posting
- Financial reports
- Guest/reservation viewing

### Data Persistence
- Custom users stored in `system:users`
- Passwords stored with user records (encrypted in production)
- Real-time updates with functional setters
- Session-based authentication

---

## Settings Navigation Structure

### Main Settings Page (SettingsView)

**Tab Layout** (10 tabs):
1. **Branding** - Logo, colors, branding assets
2. **Tax & Payments** - Tax settings, PromptPay
3. **LINE** - LINE API configuration
4. **Alerts** - Staff alert settings
5. **Room Ready** - Room readiness notifications
6. **Daily Reports** - Daily summary settings
7. **Property** - Property information and configuration
8. **Rooms** - Room types and inventory
9. **Users** - Link to user management (in Advanced)
10. **Advanced** - System admin and user management

### Header Display
- Property name from settings
- "Settings" title
- Gear icon
- Description text

---

## Technical Implementation

### Component Structure

```
/src/components/settings/
├── SettingsView.tsx           # Main settings container with tabs
├── PropertySettings.tsx        # Property configuration
├── RoomTypeManagement.tsx      # Room types and rooms
├── UserManagementView.tsx      # User accounts and permissions
├── BrandingSettings.tsx        # Logo and branding
├── TaxSettings.tsx            # Tax configuration
├── PromptPaySettings.tsx      # Payment settings
├── LineSettings.tsx           # LINE integration
├── StaffAlertSettings.tsx     # Alert configuration
├── RoomReadyNotificationSettings.tsx
├── DailySummarySettings.tsx
└── TrendDataManager.tsx
```

### Data Storage Keys

```typescript
// Property data
'onboarding-property'         // PropertySetup
'onboarding-room-types'       // RoomTypeSetup[]
'onboarding-rooms'            // RoomSetup[]

// User data
'system:users'                // UserWithPassword[]
'auth:session'                // Current user session
```

### Type Definitions

```typescript
interface PropertySetup {
  name: string
  address: string
  city: string
  country: string
  phone: string
  email: string
  website?: string
  taxId?: string
  timeZone: string
  currency: string
  defaultCheckIn: string
  defaultCheckOut: string
  logoUrl?: string
  brandColor?: string
  receiptFooter?: string
}

interface RoomTypeSetup {
  id: string
  name: string
  baseOccupancy: number
  maxOccupancy: number
  extraGuestFee: number
  childFreeAge: number
  childFeeAge: number
  childFee: number
}

interface RoomSetup {
  id: string
  number: string
  roomTypeId: string
  status: 'available' | 'out-of-service'
  notes?: string
}

interface User {
  id: string
  username: string
  role: UserRole
  displayName: string
  createdAt: string
}
```

---

## User Experience

### Design Principles

1. **Clarity**: Clear section headers with icons
2. **Organization**: Logical grouping with separators
3. **Visual Hierarchy**: Typography and spacing
4. **Feedback**: Toast notifications for all actions
5. **Protection**: Prevent accidental data loss
6. **Validation**: Input validation before saves

### Visual Design

- **Icons**: Phosphor Icons (duotone weight)
- **Color Coding**: Role-based badge colors
- **Layout**: Grid layouts for forms, card-based sections
- **Spacing**: Generous padding and gaps
- **Typography**: Clear labels and descriptions

### Interaction Patterns

- **Edit Mode**: Toggle between view and edit
- **Dialogs**: Modal dialogs for create/edit actions
- **Inline Actions**: Direct table actions with icons
- **Bulk Operations**: Range inputs for room creation
- **Validation**: Real-time error messages

---

## Integration Points

### With Other Modules

1. **Onboarding**: Uses same data structure
2. **Board**: Reads room configuration
3. **Reservations**: Uses room types and rates
4. **Receipts**: Uses property info and branding
5. **Authentication**: Uses user accounts and roles
6. **Permissions**: Enforces role-based access

### Data Flow

```
Settings → KV Store → App State → UI Components
```

All settings changes:
1. Validated in component
2. Saved to KV store with functional updates
3. Reflected immediately in UI
4. Available to other modules instantly

---

## Security Considerations

### User Management
- Cannot delete own account
- Cannot edit username after creation
- Password minimum length enforced
- Password confirmation required
- Role-based permission enforcement

### Property Settings
- Admin-only access recommended
- Validation on all inputs
- No destructive actions without confirmation

### Data Validation
- Required field enforcement
- Type validation (numbers, emails, URLs)
- Range validation (room numbers)
- Duplicate detection (usernames, room numbers)

---

## Future Enhancements

### Property Settings
- [ ] Logo upload functionality
- [ ] Multi-property support
- [ ] Advanced tax configuration
- [ ] Custom field definitions
- [ ] Property photo gallery

### Room Management
- [ ] Room amenities configuration
- [ ] Room photos/gallery
- [ ] Floor plans
- [ ] Room-specific rates
- [ ] Maintenance schedules

### User Management
- [ ] User activity logs
- [ ] Password expiration policies
- [ ] Two-factor authentication
- [ ] Session management
- [ ] User groups/teams
- [ ] Custom permission sets
- [ ] User profiles with photos

### System Settings
- [ ] Data backup/export
- [ ] Audit log viewer
- [ ] Email templates
- [ ] Webhook configuration
- [ ] API access management

---

## Testing Checklist

### Property Settings
- [x] Edit and save property information
- [x] Change timezone and currency
- [x] Update check-in/check-out times
- [x] Modify brand color
- [x] Add receipt footer text
- [x] Cancel edits (data reverts)
- [x] View room configuration summary

### Room Management
- [x] Create new room type
- [x] Edit existing room type
- [x] Delete room type (with protection)
- [x] Add bulk rooms with range
- [x] Delete individual rooms
- [x] Prevent duplicate room numbers
- [x] View rooms grouped by type

### User Management
- [x] Create new user account
- [x] Edit user display name and role
- [x] Change user password
- [x] Delete user (with protection)
- [x] Validate password strength
- [x] Confirm password matches
- [x] View default accounts
- [x] View role permissions

---

## Performance Notes

- All settings load instantly from KV store
- Functional updates prevent stale data
- Optimistic UI updates for responsiveness
- No external API calls required
- Efficient re-renders with React hooks

---

## Completion Status

✅ **Property Settings** - 100% Complete
- All fields implemented
- Edit/save functionality
- Data persistence
- Visual design polished

✅ **Room Type Management** - 100% Complete
- CRUD operations for room types
- Bulk room creation
- Room inventory display
- Validation and protection

✅ **User Management** - 100% Complete
- Full CRUD for users
- Password management
- Role assignment
- Permission display
- Security protections

---

## Documentation

### For Administrators

**Setting Up Your Property**:
1. Navigate to Settings → Property
2. Click "Edit Property"
3. Fill in all required fields (marked with *)
4. Set your timezone and currency
5. Configure check-in/check-out times
6. Choose your brand color
7. Add receipt footer text
8. Click "Save Changes"

**Managing Room Types**:
1. Navigate to Settings → Rooms
2. Click "Add Room Type"
3. Enter room type details and policies
4. Click "Create Room Type"
5. Repeat for each room type

**Adding Rooms**:
1. Navigate to Settings → Rooms
2. Click "Add Rooms"
3. Select room type
4. Enter start and end room numbers
5. Click "Add Rooms"

**Managing Users**:
1. Navigate to Settings → Advanced
2. Click "Manage Users"
3. Click "Add User"
4. Fill in user details
5. Assign appropriate role
6. Click "Create User"

### For Developers

**Adding New Settings**:
1. Create component in `/src/components/settings/`
2. Add KV store hooks for data persistence
3. Implement form validation
4. Add to SettingsView.tsx as new tab
5. Update type definitions if needed

**Modifying Property Schema**:
1. Update `PropertySetup` interface in types
2. Update form fields in PropertySettings.tsx
3. Update validation logic
4. Test data migration if needed

---

## Summary

The Property and User Settings modules provide a complete, professional-grade configuration system for the Sandbox Hotel PMS. All essential features are implemented, tested, and ready for production use. The system is intuitive, secure, and fully integrated with the rest of the PMS.
