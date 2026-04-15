import { useLocation } from "react-router-dom";

export default function Placeholder() {
  const location = useLocation();
  const page = location.pathname.split("/").pop() || "Page";
  const title = page.charAt(0).toUpperCase() + page.slice(1);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-muted-foreground">This section is coming soon.</p>
    </div>
  );
}
