// Ошибка в странице не должна оставлять пустое окно: показать, что случилось, и дать
// перезагрузить. Несохранённое в заметке к этому времени уже ушло в базу (автосохранение).

import { Component, type ReactNode } from 'react';

export class Guard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="dk-crash">
        <h2>Что-то сломалось</h2>
        <p className="muted">{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Перезагрузить (F5)
        </button>
      </div>
    );
  }
}
