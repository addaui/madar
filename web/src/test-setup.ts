import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(() => cleanup());

// jsdom does not lay anything out, so it has no scrollIntoView.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
