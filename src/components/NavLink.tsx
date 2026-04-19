import { Link } from "@tanstack/react-router";
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
    return (
      <Link
        to={to as never}
        ref={ref as never}
        className={cn(className)}
        activeOptions={{ exact: !!end }}
        activeProps={{ className: cn(className, activeClassName) }}
        inactiveProps={{ className: cn(className, pendingClassName) }}
        {...rest}
      >
        {children}
      </Link>
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
