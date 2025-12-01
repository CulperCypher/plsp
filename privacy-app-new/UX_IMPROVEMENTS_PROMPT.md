# UX Improvements Prompt for GPT 5.1 Codex

## Context
This is a privacy-preserving liquid staking dApp built with React + TypeScript. Users can stake STRK to receive spSTRK tokens, with optional privacy features using ZK proofs. The app also has a Zcash bridge for cross-chain private deposits.

## Current Tech Stack
- React 18 + TypeScript
- Starknet.js for blockchain interaction
- Noir circuits for ZK proofs
- CSS custom properties for theming

---

## CRITICAL FIXES (Implement First)

### 1. Note Safety System
**Problem:** Users must manually save a text note. If lost = funds permanently lost.

**Requirements:**
- Add prominent warning banner when note is generated: "⚠️ SAVE THIS NOTE OR LOSE YOUR FUNDS FOREVER"
- Force download of note file before allowing any further actions
- Add checkbox: "I confirm I have saved my note securely" - must be checked to proceed
- Store note temporarily in localStorage as backup (with security warning)
- Add "Verify Note" feature where user can paste note to confirm it matches

### 2. Toast Notification System
**Problem:** App uses `alert()` which blocks UI and feels dated.

**Requirements:**
- Implement toast notification system (bottom-right corner)
- Toast types: success (green), error (red), warning (yellow), info (blue)
- Auto-dismiss after 5 seconds, with manual close button
- Stack multiple toasts vertically
- Include transaction hash links for blockchain operations
- Animate in/out smoothly

**Example API:**
```typescript
toast.success('Transaction submitted!', { 
  txHash: '0x123...', 
  duration: 5000 
});
toast.error('Transaction failed: insufficient balance');
toast.warning('Note not saved yet!');
```

### 3. Multi-Step Transaction UI
**Problem:** Operations like stake require 2 transactions (approve + stake) but user has no visibility.

**Requirements:**
- Create a transaction stepper modal that shows:
  - Step 1: "Approving STRK spend..." with spinner
  - Step 2: "Staking STRK..." with spinner
  - Step 3: "Complete!" with checkmark
- Each step shows: pending → in progress → complete → error states
- Allow user to see transaction hashes at each step
- "View on Explorer" links for each transaction
- If step fails, show retry button for that specific step

**Visual Design:**
```
┌────────────────────────────────────┐
│  Staking 12 STRK → 10 spSTRK       │
├────────────────────────────────────┤
│  ✓ Step 1: Approve STRK            │
│    tx: 0x123...abc  [View ↗]       │
│                                    │
│  ◉ Step 2: Stake STRK              │
│    Waiting for confirmation...     │
│                                    │
│  ○ Step 3: Complete                │
├────────────────────────────────────┤
│  [Cancel]              [View All]  │
└────────────────────────────────────┘
```

### 4. Confirmation Modals
**Problem:** Clicking action buttons immediately fires transactions with no confirmation.

**Requirements:**
- Show confirmation modal before any blockchain transaction
- Display: action summary, amounts, gas estimate (if available)
- For private operations, add extra warning about irreversibility
- Buttons: "Cancel" and "Confirm"

---

## HIGH PRIORITY IMPROVEMENTS

### 5. Bridge Section Cleanup
**Problem:** Bridge section has duplicate/confusing inputs.

**Requirements:**
- Remove the "STRK Equivalent" input field from bridge section
- Bridge flow should only show:
  1. Generate commitment button
  2. Live ZEC quote (calculated automatically)
  3. Copy buttons (address, amount, memo)
  4. Note save section
- Add QR code for bridge address (use qrcode.react library)

### 6. Collapse Advanced Fields
**Problem:** Secret, blinding, commitment fields are technical and confuse users.

**Requirements:**
- Hide these in a collapsible "Advanced / Technical Details" accordion
- Default state: collapsed
- Show simplified flow: [Generate Note] → [Save Note] → [Deposit]
- Power users can expand to see/edit raw values

### 7. Transaction History Panel
**Requirements:**
- Add "Recent Activity" section to sidebar or dedicated tab
- Show last 10 transactions with status, type, amount, timestamp
- Link to block explorer for each
- Persist in localStorage

---

## MEDIUM PRIORITY

### 8. Better Error Messages
- Parse common blockchain errors into human-readable messages
- "Insufficient balance" instead of raw revert data
- Suggest fixes: "You need 0.5 more STRK to complete this transaction"

### 9. Loading States
- Skeleton loaders for stats grid while fetching
- Disable buttons with spinner during operations
- "Refreshing..." indicator on manual refresh

### 10. Mobile Responsiveness
- Hamburger menu for sidebar on mobile
- Stack swap boxes vertically on small screens
- Touch-friendly button sizes (min 44px)

---

## LOW PRIORITY (Post-Launch)

### 11. Dark/Light Mode Toggle
### 12. Gas Price Indicator
### 13. Price Charts for Exchange Rate History
### 14. Notification Sound Options
### 15. Keyboard Shortcuts

---

## Implementation Notes

- Use React Context for toast system (ToastProvider)
- Use React Portal for modals
- Animations with CSS transitions or Framer Motion
- Keep bundle size minimal - avoid heavy libraries
- Test all flows on Sepolia testnet before mainnet

---

## File Structure Suggestion

```
src/
├── components/
│   ├── Toast/
│   │   ├── ToastProvider.tsx
│   │   ├── Toast.tsx
│   │   └── toast.css
│   ├── TransactionStepper/
│   │   ├── TransactionModal.tsx
│   │   ├── StepIndicator.tsx
│   │   └── transaction.css
│   ├── ConfirmModal/
│   │   └── ConfirmModal.tsx
│   └── NoteSafety/
│       ├── NoteWarning.tsx
│       └── NoteSaveCheckbox.tsx
├── hooks/
│   ├── useToast.ts
│   └── useTransactionSteps.ts
└── ...
```
