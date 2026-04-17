import { BeamEnergyPV, Hexapod, Histogram, Bento } from "@blueskyproject/finch";
export default function ControlPage() {
      return (
    <div>
      <h2>Device Controls</h2>
        <Bento>
            <BeamEnergyPV pv="fake mirror" demo={true} />
            <Hexapod prefix="fake hexapod" demo={true} />
            <Histogram arrayPV="fake array" acquirePV="fake acquire" demo={true} />
        </Bento>
    </div>
  );
}