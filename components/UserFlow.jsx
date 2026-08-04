"use client";

import React, { useState } from "react";
import AccessGate from "./AccessGate";
import AtsCvBuilder from "./AtsCvBuilder";

export default function UserFlow({ initialAccessCode = null }) {
  const [accessCode, setAccessCode] = useState(initialAccessCode);

  if (!accessCode) {
    return <AccessGate onContinue={(code) => setAccessCode(code)} />;
  }
  return <AtsCvBuilder accessCode={accessCode} />;
}
