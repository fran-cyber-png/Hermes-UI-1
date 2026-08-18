import { gruposDe } from '../catalogo';
import { RibbonGrupos } from '../RibbonGrupos';

/** Pendiente de cablear: ver la fase correspondiente. */
export function TabDibujar() {
  return <RibbonGrupos edita={false} grupos={gruposDe('dibujar')} />;
}
