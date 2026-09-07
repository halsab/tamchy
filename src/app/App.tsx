import strings from '../content/tt.json';
import styles from './App.module.css';

export function App() {
  return (
    <main className={styles.root}>
      <h1 className={styles.title}>{strings.app.name}</h1>
    </main>
  );
}
