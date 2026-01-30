# Docs

## Patrón de Listado con Plantillas HTML

Para renderizar listas de elementos repetitivos (como filas de tabla `<tr>` o items de lista `<li>`) sin inyectar cadenas HTML en el código JavaScript/TypeScript, se utiliza el siguiente patrón:

1.  **Definir la Plantilla en HTML**:
    Dentro del contenedor de la lista, define un elemento que servirá como plantilla para cada ítem. Asignale un `data-cb`.

    ```html
    <tbody data-cb="listContainer">
    	<!-- Plantilla del item -->
    	<tr data-cb="listItem">
    		<td data-cb="colName"></td>
    	</tr>
    </tbody>
    ```

2.  **Utilizar la Plantilla en TypeScript**:
    Usa la propiedad correspondiente del objeto `tpl` (que coincidirá con el `data-cb` definido) como una función constructora para crear nuevas instancias de ese elemento.

    ```typescript
    import tpl from './MyView.html';

    // ...

    return tpl.fragment({
    	listContainer: {
    		// Mapeamos los datos a componentes usando tpl.listItem
    		// IMPORTANTE: Envolver en una función para reactividad y usar .get()
    		inner: () =>
    			itemsSignal.get().map((item) =>
    				tpl.listItem({
    					nodes: { colName: { text: item.name } },
    				})
    			),
    	},
    });
    ```

    _Nota: Al asignar el contenido al `inner` del contenedor, la plantilla original definida en el HTML es reemplazada por la lista generada, por lo que no aparece duplicada._
