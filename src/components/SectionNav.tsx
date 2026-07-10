import { Link, useLocation } from "react-router-dom";
import { SECONDARY_NAVIGATION, isSecondaryNavigationItemActive, type SecondaryNavigationSection } from "@/lib/appNavigation";
import { preloadAppRoute } from "@/lib/appRoutePreloaders";

interface SectionNavProps {
  section: SecondaryNavigationSection;
  label: string;
  isAdmin?: boolean;
}

export function SectionNav({ section, label, isAdmin = false }: SectionNavProps) {
  const location = useLocation();
  const items = SECONDARY_NAVIGATION[section].filter((item) => !item.adminOnly || isAdmin);

  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex min-w-full gap-1 rounded-xl border border-border bg-card p-1 sm:min-w-0">
        {items.map((item) => {
          const active = isSecondaryNavigationItemActive(location.pathname, item);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? "page" : undefined}
              onFocus={() => preloadAppRoute(item.href)}
              onPointerEnter={() => preloadAppRoute(item.href)}
              onTouchStart={() => preloadAppRoute(item.href)}
              className={[
                "flex min-h-11 min-w-[7.25rem] flex-1 items-center justify-center rounded-[10px] px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
