export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section className="card offline-card">
        <div className="offline-icon">!</div>
        <h1>Нет подключения к интернету</h1>
        <p>
          Ранее сохранённые страницы доступны. Введённые ответы останутся на устройстве и
          синхронизируются после восстановления соединения.
        </p>
        <a className="button" href="/dashboard">Повторить</a>
      </section>
    </main>
  );
}
