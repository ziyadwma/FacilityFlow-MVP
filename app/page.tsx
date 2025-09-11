import dynamic from "next/dynamic";

// Avoid SSR issues with localStorage by rendering on client only
const FacilityFlowMVP = dynamic(() => import("@/components/FacilityFlowMVP"), { ssr: false });

export default function Page() {
  return <FacilityFlowMVP />;
}
