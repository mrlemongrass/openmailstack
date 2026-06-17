  To modernize the SOGo Webmail UX and replace its aging AngularJS (1.x) frontend with a fluid, modern React/Vue SPA, we need a highly methodical approach. SOGo’s C++ backend is incredibly robust, so our goal is strictly to build a presentation layer that acts as a client to SOGo's existing internal APIs.
  Here is a comprehensive, step-by-step proposal divided into strict logical milestones. Progress to the next milestone cannot occur until all criteria of the previous milestone are fully met and validated.
  ──────
  ### 🚩 Milestone 1: API Discovery & Authentication Mapping

  You cannot build a UI without understanding the data layer. SOGo does not have a widely publicized REST API for its frontend; the AngularJS app consumes internal endpoints. We must reverse-engineer this.

  Actions:

  1. Network Interception: Deploy a staging instance of OpenMailStack. Use browser developer tools and proxy software (like Burp Suite or Charles Proxy) to intercept all traffic between the existing SOGo AngularJS frontend and the C++ backend.
  2. Endpoint Documentation: Map out every single HTTP request (GET/POST/PUT/DELETE) for core functions. Document the exact JSON/XML payload structures required for:
      • Fetching folder lists and unread counts.
      • Fetching the email list for a folder.
      • Fetching the raw/parsed body of a specific email.
      • Sending an email (including multipart form data for attachments).
  3. Authentication Handshake: Precisely document how SOGo handles sessions. Identify the login endpoint, how cookies ( x-webobjects-sessionid  or similar) are set, and how CSRF tokens are negotiated and passed in headers.
  4. Deliverable: A comprehensive Postman Collection or OpenAPI/Swagger specification of the internal SOGo API.
  ──────
  ### 🚩 Milestone 2: Technology Stack Selection & Foundation

  Once the API is documented, we lay the groundwork for the modern SPA.

  Actions:
  1. Framework Selection: Choose Vue 3 (Nuxt) or React (Vite/Next.js). Given the OpenMailStack Admin Portal already utilizes vanilla JS and values lightweight speeds, Vue 3 or a lightweight React setup (Vite) is highly recommended over bloated frameworks.
  2. State Management: Implement a modern state store (Pinia for Vue, or Zustand for React) to manage global state like unread mail counts, active user profile, and cached folder trees.
  3. Design System: Establish the "Glassmorphism" design tokens (CSS variables, colors, typography) to ensure visual parity with the gorgeous OpenMailStack Admin Portal. Select a headless component library (like Radix UI or Headless UI) to build accessible modals, dropdowns, and context menus.
  4. Dev Proxy Setup: Configure the local development server (e.g., Vite proxy) to route  /SOGo  API requests directly to the staging server to bypass CORS issues during local development.
  5. Deliverable: A compiling "Hello World" application with routing, state management, and an API service class capable of making an authenticated request to the SOGo backend.
  ──────
  ### 🚩 Milestone 3: Authentication & Application Shell

  Building the skeletal framework of the application.

  Actions:

  1. Login Interface: Build a stunning, modern login screen. Hook it up to the API to handle authentication, MFA (if supported by SOGo), and error handling (wrong password, account locked).
  2. Session Management: Implement secure handling of the SOGo session tokens and automatic token refreshing/re-authentication logic.
  3. The App Shell: Build the primary layout structure:
      • Left Sidebar: Navigation for Mail, Contacts, Calendar, and settings.
      • Top App Bar: Global search input, user profile avatar, and quick-action buttons.
      • Main Content Area: The dynamic router view.
  4. Theming: Implement a robust Dark Mode / Light Mode toggle that respects the user's OS preferences.
  5. Deliverable: A user can log in, see the application shell, toggle dark mode, and log out successfully.
  ──────
  ### 🚩 Milestone 4: Read-Only Mailbox Operations

  The core of any webmail is reading emails. This must be extremely fast and secure.

  Actions:

  1. Folder Tree Navigation: Fetch and render the user's IMAP folders (Inbox, Sent, Trash, Custom Folders) in the sidebar. Implement real-time or polled unread count badges.
  2. Email List View: Build the central inbox view. Implement virtualized scrolling (or infinite pagination) to handle thousands of emails smoothly. Include visual indicators for read/unread, attachments, and flagged status.
  3. Email Reading Pane: Build the detail view for reading a thread.
  4. HTML Sanitization (CRITICAL): Integrate a library like DOMPurify. Emails contain arbitrary HTML from the internet. You must aggressively sanitize the HTML returned by SOGo before rendering it in the React/Vue DOM to prevent XSS attacks.
  5. Deliverable: A user can click through their folders, scroll through their emails, and safely read HTML emails and view inline images.
  ──────
  ### 🚩 Milestone 5: Compose & Write Actions

  Transitioning the app from read-only to fully interactive.

  Actions:

  1. Rich Text Editor: Integrate a modern, lightweight WYSIWYG editor (like TipTap or Quill) for composing emails.
  2. Recipient Auto-Complete: Implement dynamic fetching against the SOGo Contacts API as the user types in the To/Cc/Bcc fields.
  3. Attachment Handling: Build a drag-and-drop file upload zone. Hook it into the SOGo attachment upload endpoints, ensuring progress bars and chunking (if necessary) are handled smoothly.
  4. Mail Actions: Wire up the API calls for: Reply, Reply All, Forward, Move to Folder, Mark as Spam, Mark as Read/Unread, and Delete.
  5. Deliverable: A user can compose a formatted email with attachments, send it successfully, and perform state-changing actions on existing emails.
  ──────
  ### 🚩 Milestone 6: Contacts & Calendar Modules

  SOGo is a groupware suite; we must support its other pillars.

  Actions:

  1. Contacts Module: Build the Address Book interface. Implement list views, detailed contact cards, and the ability to create/edit/delete contacts.
  2. Calendar Module: Integrate a robust calendar library (like FullCalendar).
  3. Event Management: Hook up the APIs to fetch events, render them on month/week/day views, and create modals for scheduling new meetings, setting recurring rules, and inviting attendees.
  4. Deliverable: Full CRUD (Create, Read, Update, Delete) capability for both the Address Book and the Calendar.
  ──────
  ### 🚩 Milestone 7: Performance, Polish, & PWA

  Taking the application from "functional" to "premium."

  Actions:

  1. Keyboard Shortcuts: Implement a comprehensive hotkey system (e.g., pressing  c  to compose,  j / k  to navigate up and down the inbox) to mimic power-user features found in Gmail.
  2. Caching & Offline Support: Implement Service Workers (via Workbox) to cache the UI shell and recent emails, allowing the app to load instantly and function gracefully on poor network connections (Progressive Web App).
  3. Micro-Animations: Add subtle, satisfying CSS transitions (e.g., emails sliding into the trash, modals popping open with a slight spring effect) to elevate the UX.
  4. Deliverable: An application that feels instantly responsive, supports keyboard navigation, and provides a state-of-the-art user experience.
  ──────
  ### 🚩 Milestone 8: Security Audit & Deployment Pipeline

  Integrating the new frontend back into OpenMailStack.

  Actions:

  1. Automated Testing: Write Cypress or Playwright End-to-End (E2E) tests covering the critical paths (Login -> Read Email -> Reply -> Logout) to prevent future regressions.
  2. Security Audit: Conduct a dedicated review focusing specifically on CSRF token handling and DOM-based XSS vulnerabilities within the email reading pane.
  3. Build Pipeline: Create the production build scripts ( npm run build ) to generate the static HTML/JS/CSS bundle.
  4. OpenMailStack Integration: Update the  install.sh  bash scripts. Instead of deploying the legacy AngularJS SOGo frontend files, the bash script will map Nginx to serve our new compiled static frontend assets, while reverse-proxying API requests directly to the local SOGo C++ daemon on port  20000 .
  5. Deliverable: A seamless, automated installation process where a fresh OpenMailStack deployment boots directly into the new frontend.
