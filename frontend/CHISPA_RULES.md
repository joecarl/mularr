# Guía de Desarrollo con Chispa

## Estructura de Componentes y `data-cb`

Cuando se trabaja con `chispa` y plantillas HTML, está permitido no mantener la correspondencia jerárquica entre los elementos HTML definidos con `data-cb` y la estructura del objeto pasado a `tpl.fragment` (o funciones similares).

### Regla de Anidamiento

Si un elemento HTML con `data-cb` es hijo de otro elemento con `data-cb`, esta relación no tiene por qué reflejarse en el código TypeScript utilizando la propiedad `nodes`.

**Ejemplo HTML:**

```html
<div data-cb="modal">
	<form data-cb="formulario">
		<button data-cb="botonCancelar">Cancelar</button>
	</form>
</div>
```

**Código TypeScript Plano (recomendado en la mayoria de los casos):**

```typescript
// ESTO ES CORRECTO incluso si los elementos están anidados en el HTML
return tpl.fragment({
    modal: { ... },
    formulario: { ... },
    botonCancelar: { ... }
});
```

**Código TypeScript Anidado (solo recomendado si el anidamiento es muy relevante y se quiere dejar reflejado en el código):**

```typescript
return tpl.fragment({
    modal: {
        // Propiedades del modal (style, etc.)
        nodes: {
            formulario: {
                // Propiedades del formulario (onsubmit, etc.)
                nodes: {
                    botonCancelar: {
                        // Propiedades del botón (onclick, etc.)
                        onclick: () => { ... }
                    }
                }
            }
        }
    }
});
```

## Gestión de Clases y Reactividad

Chispa ofrece formas específicas para manejar clases y reactividad que no requieren el uso explícito de `computed` en todas partes.

### Clases CSS

1.  **Clases Fijas**: Deben definirse directamente en el HTML.

    ```html
    <div class="card p-3" data-cb="myCard">...</div>
    ```

2.  **Clases Variables (`addClass`)**: Utiliza `addClass` para añadir una clase dinámicamente. Si necesitas manejar mas de 1 clase con addClass puedes usar un array.

    ```typescript
    myCard: {
    	addClass: () => 'platform-' + platformName.get();
    }
    ```

3.  **Clases Condicionales Booleanas (`classes`)**: Utiliza el objeto `classes` para activar/desactivar clases según una condición.
    ```typescript
    myCard: {
        classes: {
            'visible': () => isVisible.get(),
            'error': () => hasError.get()
        }
    }
    ```

**Si se usa la propiedad `className`** se reemplazarán todas las clases, ya que esto sobrescribe las clases definidas en el HTML y ninguno de los puntos anteriores tendrá efecto.

### Funciones vs Computed

Para las propiedades, **NO es necesario usar `computed`**. Puedes pasar una función directamente y Chispa la tratará reactivamente:

- `inner`
- `addClass`
- `classes` (y sus propiedades individuales)
- `style` (y sus propiedades individuales)
- `dataset` (y sus propiedades individuales)
- todas las propiedades del nodo

**Ejemplo Correcto:**

```typescript
inner: () => `Hola ${name.get()}`;
title: () => `Hola ${name.get()}`;
```

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

## Estructura de Archivos

- **Componentes**: `Component.ts` + `Component.html` + `Component.css` (opcional).
- **Servicios**: Clases Singleton inyectadas vía `ServiceContainer`.
- **Estado Global**: Usar servicios (`StoreService`, de signals) en lugar de contextos de React.

## Ocultar y mostrar nodos

Para controlar la visibilidad de un nodo mediante la propiedad CSS `display`:

- Para **ocultarlo**: asignar `'none'`.
- Para **mostrarlo**: asignar `''` (cadena vacía), no `'block'` ni ningún otro valor explícito. Esto evita forzar un tipo de display concreto y deja que el CSS del elemento lo determine.

```ts
tpl.myNode({
	style: {
		display: () => (showSignal.get() ? '' : 'none'),
	},
});
```

## Renderizar un nodo independiente

Cuando se renderiza un nodo individual de la plantilla (no un `fragment`), la estructura del objeto que se le pasa es diferente:

- En **`tpl.fragment`**: el objeto contiene directamente los nodos descendientes como claves del objeto raíz.
- En un **nodo individual**: el objeto describe las propiedades del propio nodo. Los nodos descendientes se pasan bajo la clave `nodes`.

```ts
// Renderizar un nodo individual con nodos descendientes
tpl.myNode({
	nodes: {
		colName: { text: item.name },
	},
});
```

## No usar `document.createElement`

**Nunca** se debe usar `document.createElement` (ni ninguna API imperativa del DOM como `innerHTML`) para construir nodos en componentes Chispa. Todo elemento HTML que se necesite debe declararse en la plantilla `.html` con un `data-cb` apropiado y construirse mediante `tpl.<dataCb>(...)`.

Esto aplica especialmente a elementos que se renderizan en listas: usa el patrón `componentList` + `tpl.<itemDataCb>()` en lugar de crear nodos manualmente.

**Incorrecto:**

```ts
const item = document.createElement('div');
item.className = 'card';
item.textContent = name;
container.appendChild(item);
```

**Correcto:**

```html
<!-- En el .html -->
<div data-cb="card" class="card">
	<span data-cb="cardName"></span>
</div>
```

```ts
// En el .ts, dentro de componentList o de inner:
tpl.card({
	nodes: { cardName: { inner: name } },
});
```
