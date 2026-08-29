import { useEffect, useState } from "@lynx-js/react";
import { useLynxI18next } from "@lynxship/i18n/react-lynx";
import { i18n } from "./i18n.js";

const locales = ["en", "fr", "ar"] as const;

export function App() {
  const { t, ready, locale, direction } = useLynxI18next("translation");
  const [selectedLocale, setSelectedLocale] = useState("en");

  useEffect(() => {
    void i18n.init();
  }, []);

  const changeLocale = () => {
    const current = locale ?? selectedLocale;
    const index = locales.indexOf(current as (typeof locales)[number]);
    const next = locales[(index + 1) % locales.length] ?? "en";
    setSelectedLocale(next);
    void i18n.changeLanguage(next);
  };

  return (
    <view style={{ direction, padding: "32px", background: "#08111f" }}>
      <text style={{ color: "#16d9b4", fontSize: "20px" }}>{t("title")}</text>
      <text style={{ color: "#eef4ff", marginTop: "16px" }}>
        {ready ? t("description") : "Loading translations…"}
      </text>
      <text style={{ color: "#9db1ca", marginTop: "16px" }}>
        {t("language", { locale: locale ?? selectedLocale })}
      </text>
      <text style={{ color: "#9db1ca", marginTop: "16px" }}>
        {t("items", { count: 2 })}
      </text>
      <view
        bindtap={changeLocale}
        style={{
          background: "#16d9b4",
          borderRadius: "12px",
          marginTop: "24px",
          padding: "16px",
        }}
      >
        <text style={{ color: "#06101a", textAlign: "center" }}>
          Change language
        </text>
      </view>
    </view>
  );
}
