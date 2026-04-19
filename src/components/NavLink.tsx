import { Link, useLocation } from "react-router-dom";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  to: string;
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
  children?: ReactNode;
  end?: boolean;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, children, end, ...rest }, ref) => {
    const location = useLocation();
    const isActive = end
      ? location.pathname === to
      : location.pathname === to || location.pathname.startsWith(to + "/");
    return (
      <Link
        to={to}
        ref={ref}
        className={cn(className, isActive ? activeClassName : pendingClassName)}
        {...rest}
      >
        {children}
      </Link>
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
