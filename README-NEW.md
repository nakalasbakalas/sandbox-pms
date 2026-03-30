# Sandbox Hotel PMS — Complete Architecture & Design

**A production-ready Property Management System for boutique hotel operations in Thailand**

> **Not a prototype. Not a demo. A production business system.**

---

## 🎯 Quick Start

**New to this project?** Start here:

1. **[EXECUTIVE-SUMMARY.md](./EXECUTIVE-SUMMARY.md)** — System overview, roadmap, success criteria (20 min read)
2. **[IMPLEMENTATION-GUIDE.md](./IMPLEMENTATION-GUIDE.md)** — Developer onboarding, quick reference (15 min read)
3. **[PRD.md](./PRD.md)** — Product vision, user roles, module map (30 min read)

**Ready to build?** Follow the implementation roadmap in the Executive Summary.

---

## 📚 Complete Documentation

### **Foundation Documents**
- **[EXECUTIVE-SUMMARY.md](./EXECUTIVE-SUMMARY.md)** — Complete system summary and 24-week roadmap
- **[IMPLEMENTATION-GUIDE.md](./IMPLEMENTATION-GUIDE.md)** — Developer quick reference and onboarding
- **[SYSTEM-ARCHITECTURE-MAP.md](./SYSTEM-ARCHITECTURE-MAP.md)** — Module interconnections and data flow diagrams

### **Product & Design**
- **[PRD.md](./PRD.md)** — Product vision, principles, user roles, module map
- **[UX-ARCHITECTURE.md](./UX-ARCHITECTURE.md)** — Navigation, design system, component patterns

### **Technical Foundation**
- **[TECHNICAL-ARCHITECTURE.md](./TECHNICAL-ARCHITECTURE.md)** — Tech stack, folder structure, deployment
- **[DATA-MODEL.md](./DATA-MODEL.md)** — Database schema, business rules, lifecycle models
- **[SECURITY.md](./SECURITY.md)** — Security model, authentication, authorization

### **Core Operational Modules**
- **[BOARD-AND-OPERATIONS.md](./BOARD-AND-OPERATIONS.md)** — Room board, front desk, check-in/check-out
- **[GUEST-HOUSEKEEPING-DOCUMENTS.md](./GUEST-HOUSEKEEPING-DOCUMENTS.md)** — Guest profiles, housekeeping
- **[BOOKING-ENGINE-AND-FINANCIAL-OPS.md](./BOOKING-ENGINE-AND-FINANCIAL-OPS.md)** — Public booking, cashier, payments
- **[RATES-AND-PRICING.md](./RATES-AND-PRICING.md)** — Pricing engine, rate rules, rate calendar
- **[OTA-CHANNEL-MANAGER.md](./OTA-CHANNEL-MANAGER.md)** — Channel integration, OTA sync

### **Operational Intelligence Layer**
- **[REPORTING-AND-INTELLIGENCE.md](./REPORTING-AND-INTELLIGENCE.md)** — Reports, KPIs, analytics
- **[DASHBOARDS.md](./DASHBOARDS.md)** — Front desk, manager, housekeeping dashboards
- **[LINE-INTEGRATION.md](./LINE-INTEGRATION.md)** — LINE messaging (Thailand-first)
- **[MESSAGING-ARCHITECTURE.md](./MESSAGING-ARCHITECTURE.md)** — Unified communication layer
- **[LAUNCH-READINESS.md](./LAUNCH-READINESS.md)** — Security hardening, testing, launch checklist

---

## 🏨 Property Overview

**Sandbox Hotel:**
- 30 rooms: Twin (201-215), Double (301-315)
- Rooms 216, 316: Non-sellable
- No overbooking permitted
- Check-in: 14:00, Check-out: 11:00
- Extra guest: 200 THB/night
- Children: 0-5 free, 6-11: 100 THB/night

---

## 🎨 Core Philosophy

- **Board-first:** Everything radiates from the room board
- **Operations-first:** Speed over features, clarity over complexity
- **Thailand-first:** LINE integration, local workflows, THB currency
- **Production-minded:** No shortcuts, no data loss, no double bookings

> *This is not generic enterprise software adapted for small hotels.*  
> *This is boutique hotel operations, digitally perfected.*

---

## 🛠 Tech Stack

**Frontend:** Next.js 14+, React 19, TypeScript, Tailwind CSS, Shadcn UI  
**Backend:** Next.js API Routes, Prisma ORM, PostgreSQL  
**Integrations:** LINE Messaging API, Booking.com, Agoda, Expedia, Airbnb

---

## 🚀 Implementation Roadmap

**24-week phased implementation:**

1. Foundation (Weeks 1-3)
2. Board & Operations (Weeks 4-6)
3. Guest & Housekeeping (Weeks 7-8)
4. Financial Operations (Weeks 9-10)
5. Rates & Pricing (Weeks 11-12)
6. Public Booking (Weeks 13-14)
7. OTA Integration (Weeks 15-17)
8. LINE & Messaging (Weeks 18-19)
9. Reporting & Dashboards (Weeks 20-21)
10. Hardening & Launch (Weeks 22-24)

See **[EXECUTIVE-SUMMARY.md](./EXECUTIVE-SUMMARY.md)** for detailed roadmap.

---

## ✅ Success Criteria

**Launch-ready when:**
- Zero double bookings (critical)
- Zero data loss (critical)
- Check-in time <45 seconds
- Board load time <3 seconds
- >95% staff satisfaction
- >99.5% uptime

---

## 📦 What's Included

✅ Complete architectural design (16 documents)  
✅ Detailed data model and schema  
✅ UI/UX specifications and design system  
✅ Business logic and workflow definitions  
✅ Integration architecture (OTA, LINE)  
✅ Security and hardening guidelines  
✅ Testing and launch checklists  
✅ Implementation roadmap  

❌ Actual code implementation (architecture only)  
❌ Deployed system  
❌ Test data or fixtures  

**This is a complete design specification ready for implementation.**

---

## 📖 How to Use This Repository

**For Hotel Owners/Managers:**  
Start with [EXECUTIVE-SUMMARY.md](./EXECUTIVE-SUMMARY.md) and [PRD.md](./PRD.md)

**For Project Managers:**  
Review [EXECUTIVE-SUMMARY.md](./EXECUTIVE-SUMMARY.md) for roadmap and all module documents for scope

**For Developers:**  
Begin with [IMPLEMENTATION-GUIDE.md](./IMPLEMENTATION-GUIDE.md), [TECHNICAL-ARCHITECTURE.md](./TECHNICAL-ARCHITECTURE.md), and [DATA-MODEL.md](./DATA-MODEL.md)

**For Designers:**  
Review [PRD.md](./PRD.md) and [UX-ARCHITECTURE.md](./UX-ARCHITECTURE.md)

---

## 🔒 Critical Business Rules

1. **No double booking** — Database-level enforcement + validation
2. **No overbooking** — Check availability before save
3. **No data loss** — Transaction-safe, audited operations
4. **Folio integrity** — Balance always = charges - payments
5. **Receipt immutability** — Once generated, cannot be altered
6. **Audit trail** — All critical actions logged

---

## 📄 License

Architecture and design documentation: MIT License

---

## 🙏 Built With Care

This architecture was designed specifically for Sandbox Hotel with deep consideration for Thailand hotel operations, boutique hotel workflows, and production reliability.

**Built with care. Ready for implementation. Launch when ready.**

