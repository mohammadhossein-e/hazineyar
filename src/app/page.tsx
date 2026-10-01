export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "0.5rem",
        direction: "rtl",
      }}
    >
      <h1>هزینه‌یار</h1>
      <p>سامانه ثبت هزینه‌های پروژه‌های ساختمانی</p>
      <p style={{ color: "#666" }}>
        <a href="/api/health">بررسی وضعیت سیستم</a>
      </p>
    </main>
  );
}