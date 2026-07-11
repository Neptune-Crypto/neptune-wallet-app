import { CSSProperties, useEffect, useState } from "react";

/**
 * Timer component. Pass in a timestamp, currently only accepts second-level timestamps. Millisecond support can be added later if needed.
 */
interface clockProps {
  timeStamp: number;
  style?: CSSProperties | undefined;
}

export const TimeClock = (props: clockProps) => {
  const { timeStamp, style } = props;
  const [ts, setTS] = useState(0);
  const [value, setValue] = useState("");

  // Timer function
  function updateTime() {
    setTS((prev) => prev + 1);
  }

  useEffect(() => {
    const currentTS = Math.floor(Date.now() / 1000);
    const ts = currentTS - timeStamp;
    setTS(ts);
  }, [timeStamp]);

  useEffect(() => {
    // Execute the update timer function every second
    let timer = setInterval(updateTime, 1000);
    // Triggered when the component is destroyed, clean up unused timers and release system resources
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setValue(formatElapsed(ts));
  }, [ts]);

  // Two most significant units only: seconds are noise (and a per-second tick
  // is a distraction) once the elapsed time is in hours — e.g. a pending
  // transaction from this morning reads "5 h 12 m ago".
  function formatElapsed(elapsed: number) {
    const t = Math.max(0, elapsed);
    const days = Math.trunc(t / 86400);
    const hours = Math.trunc((t % 86400) / 3600);
    const minutes = Math.trunc((t % 3600) / 60);
    const seconds = t % 60;
    if (t < 60) return `${seconds} s ago`;
    if (t < 3600) return `${minutes} m ${seconds} s ago`;
    if (t < 86400) return `${hours} h ${minutes} m ago`;
    return `${days} d ${hours} h ago`;
  }

  return <span style={{ ...style }}>{value}</span>;
};
