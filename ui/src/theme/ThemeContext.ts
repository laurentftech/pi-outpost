import { createContext, useContext } from "react";

export const ThemeContext = createContext<"light" | "dark">("dark");

export const useThemeContext = () => useContext(ThemeContext);
