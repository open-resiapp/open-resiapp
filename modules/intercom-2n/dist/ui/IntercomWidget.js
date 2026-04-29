import React from "react";

export default function IntercomWidget(props) {
  return React.createElement(
    "div",
    {
      className:
        "rounded-xl border border-gray-200 bg-white p-5",
    },
    React.createElement(
      "h3",
      { className: "text-base font-semibold text-gray-900" },
      "Intercom (2N)"
    ),
    React.createElement(
      "p",
      { className: "mt-1 text-sm text-gray-600" },
      `Hello, ${props.community.name}. No devices paired yet.`
    )
  );
}
