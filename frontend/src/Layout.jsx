// import { NavLink, Outlet } from "react-router-dom";

// const links = [
//   { to: "/", label: "Overview", icon: "▦", end: true },
//   { to: "/servers", label: "Servers", icon: "▤" },
//   { to: "/storage", label: "Storage", icon: "▥" },
//   { to: "/analytics", label: "Analytics", icon: "▧" },
//   { to: "/model-eval", label: "Model eval", icon: "◈" },
// ];

// export default function Layout() {
//   return (
//     <div className="app-shell">
//       <div className="sidebar">
//         <div className="sidebar-logo">
//           <span className="sidebar-logo-icon">🌿</span>
//           GreenOps
//         </div>
//         {links.map((l) => (
//           <NavLink
//             key={l.to}
//             to={l.to}
//             end={l.end}
//             className={({ isActive }) => "sidebar-link" + (isActive ? " active" : "")}
//           >
//             <span aria-hidden="true">{l.icon}</span>
//             {l.label}
//           </NavLink>
//         ))}
//       </div>
//       <div className="main-content">
//         <Outlet />
//       </div>
//     </div>
//   );
// }
import { NavLink, Outlet } from "react-router-dom";

const links = [
  {
    to: "/",
    label: "Overview",
    icon: "▦",
    end: true,
  },
  {
    to: "/servers",
    label: "Servers",
    icon: "▤",
  },
  {
    to: "/storage",
    label: "Storage",
    icon: "▥",
  },
  {
    to: "/analytics",
    label: "Analytics",
    icon: "▧",
  },
  {
    to: "/model-eval",
    label: "Model eval",
    icon: "◈",
  },
  {
    to: "/recommendations",
    label: "Recommendations",
    icon: "✓",
  },
  {
    to: "/approved-actions",
    label: "Approved actions",
    icon: "◉",
  },
  {
    to: "/reports",
    label: "ESG report",
    icon: "▦",
  },
  {
    to: "/preferences",
    label: "Preferences",
    icon: "⚙",
  },
];

export default function Layout() {
  return (
    <div className="app-shell">

      {/* SIDEBAR */}

      <div className="sidebar">

        {/* LOGO */}

        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">
            🌿
          </span>

          GreenOps
        </div>


        {/* NAVIGATION */}

        <nav>

          {links.map((link) => (

            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                "sidebar-link" +
                (isActive ? " active" : "")
              }
            >

              <span aria-hidden="true">
                {link.icon}
              </span>

              {link.label}

            </NavLink>

          ))}

        </nav>

      </div>


      {/* MAIN CONTENT */}

      <div className="main-content">

        <Outlet />

      </div>

    </div>
  );
}