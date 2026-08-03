"use client";

import React, { useState } from "react";
import AccessGate from "./AccessGate";
import AtsCvBuilder from "./AtsCvBuilder";

export default function UserFlow() {
  const [unlocked, setUnlocked] = useState(false);

  if (!unlocked) {
    return <AccessGate onContinue={() => setUnlocked(true)} />;
  }
  return <AtsCvBuilder />;
}
